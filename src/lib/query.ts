import {
  QueryClient,
  useQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { invoke, normalizeError } from './ipc';
import type { Commands, Events } from './types';
import { parseProgress } from './activity';
import { describeSuccess, type Before } from './success';
import { track, useActivity } from '../stores/activity';
import { appScope, useErrors } from '../stores/errors';
import { useSuccesses } from '../stores/successes';
export const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
  },
});
export function queryKey<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
) {
  return ['repo' in args ? args.repo : 'app', command, args];
}
export function useBackend<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
  enabled = true,
  initial?: { data: Commands[K]['result']; updatedAt: number },
) {
  return useQuery({
    queryKey: queryKey(command, args),
    queryFn: () => invoke(command, args),
    enabled,
    initialData: initial?.data,
    initialDataUpdatedAt: initial?.updatedAt,
  });
}
const immutable = ['commit', 'stash', 'compare'];
const listings = ['files', 'tree'];
const references = [
  'history',
  'commit_files',
  'compare_files',
  'default_branch',
  'stashes',
  'branches',
  'blame',
  'merge_preview',
];
function refreshes(name: string, key: readonly unknown[]) {
  const [, command, args] = key as [unknown, string, { source?: string }?];
  if (name === 'repo://files-changed') return listings.includes(command);
  if (name === 'repo://head-changed') return true;
  if (references.includes(command)) return false;
  return !(
    ['diff', 'diff_stack', 'file_lines'].includes(command) &&
    immutable.includes(String(args?.source))
  );
}
function trimHistory(repo: string) {
  client.setQueriesData<InfiniteData<unknown>>(
    { queryKey: [repo, 'history'] },
    (data) =>
      data && data.pages.length > 1
        ? {
            pages: data.pages.slice(0, 1),
            pageParams: data.pageParams.slice(0, 1),
          }
        : data,
  );
}
function scopeOf(args: object) {
  return 'repo' in args ? String(args.repo) : appScope;
}
function cached(args: object): Before {
  if (!('repo' in args)) return {};
  const repo = String(args.repo);
  return {
    status: client.getQueryData(queryKey('status', { repo })),
    stashes: client.getQueryData(queryKey('stashes', { repo })),
  };
}
export async function attempt<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
) {
  const scope = scopeOf(args);
  const before = cached(args);
  const finish = track(scope, command, args);
  try {
    const result = await invoke(command, args);
    const success = describeSuccess(
      command,
      Object.fromEntries(Object.entries(args)),
      result,
      before,
    );
    if (success) useSuccesses.getState().announce(scope, success);
    return result;
  } finally {
    finish();
  }
}
export async function perform<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
): Promise<Commands[K]['result'] | undefined> {
  const scope = scopeOf(args);
  try {
    const result = await attempt(command, args);
    useErrors.getState().resolve(scope, command);
    return result;
  } catch (error) {
    useErrors.getState().report(scope, normalizeError(error), {
      command,
      retry: () => perform(command, args),
    });
    return undefined;
  }
}
export function handleEvent<K extends keyof Events>(
  name: K,
  payload: Events[K],
) {
  if (name === 'update://changed') {
    void client.invalidateQueries({ queryKey: ['app', 'update_get'] });
  } else if (name === 'settings://changed') {
    void client.invalidateQueries({ queryKey: ['app', 'settings_get'] });
    void client.invalidateQueries({ queryKey: ['app', 'ai_models'] });
  } else if (name === 'repo://closed' && payload && 'repo' in payload) {
    client.removeQueries({ queryKey: [payload.repo] });
  } else if (name === 'sync://progress' && payload && 'message' in payload) {
    const progress = parseProgress(payload.message);
    if (progress) useActivity.getState().progress(payload.repo, progress);
  } else if (payload && 'repo' in payload) {
    if (name === 'repo://head-changed') trimHistory(payload.repo);
    void client.invalidateQueries({
      queryKey: [payload.repo],
      predicate: (query) => refreshes(name, query.queryKey),
    });
  }
}
export async function connectEvents() {
  const names: (keyof Events)[] = [
    'update://changed',
    'repo://closed',
    'repo://status-changed',
    'repo://head-changed',
    'repo://files-changed',
    'settings://changed',
    'sync://progress',
  ];
  const cleanup = await Promise.all(
    names.map((name) =>
      listen<Events[typeof name]>(name, (event) =>
        handleEvent(name, event.payload),
      ),
    ),
  );
  return () => cleanup.forEach((stop) => stop());
}
