import {
  QueryClient,
  useQueries,
  useQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { invoke, normalizeError } from './ipc';
import type { Commands, Events, GitError } from './types';
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
export interface BackendSeed<K extends keyof Commands> {
  data: Commands[K]['result'];
  updatedAt: number;
}
export interface BackendGate<K extends keyof Commands> {
  enabled: boolean;
  initial?: BackendSeed<K>;
}
export function useSeededBackend<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
  gate: BackendGate<K>,
) {
  const { enabled, initial } = gate;
  return useQuery({
    queryKey: queryKey(command, args),
    queryFn: () => invoke(command, args),
    enabled: enabled,
    initialData: initial?.data,
    initialDataUpdatedAt: initial?.updatedAt,
  });
}
export function useBackend<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
  enabled = true,
) {
  return useSeededBackend(command, args, { enabled: enabled });
}
export function freshStatus(repo: string) {
  return client.fetchQuery({
    queryKey: queryKey('status', { repo }),
    queryFn: () => invoke('status', { repo }),
    staleTime: 0,
  });
}
export function useStatuses(repos: string[]) {
  return useQueries({
    queries: repos.map((repo) => ({
      queryKey: queryKey('status', { repo }),
      queryFn: () => invoke('status', { repo }),
    })),
    combine: (results) =>
      Object.fromEntries(
        repos.map((repo, index) => [repo, results[index].data]),
      ),
  });
}
const immutable = ['commit', 'stash', 'compare'];
const listings = ['files', 'tree'];
const references = [
  'history',
  'commit_files',
  'commit_detail',
  'compare_files',
  'default_branch',
  'stashes',
  'branches',
  'blame',
  'merge_preview',
];
function keyCommand(key: readonly unknown[]) {
  const command = key[1];
  return typeof command === 'string' ? command : '';
}
function keySource(key: readonly unknown[]) {
  const args = key[2];
  const hasSource =
    typeof args === 'object' && args !== null && 'source' in args;
  return hasSource ? String(args.source) : '';
}
const diffCommands = ['diff', 'diff_stack', 'file_lines'];
function isImmutableDiff(key: readonly unknown[]) {
  const isDiff = diffCommands.includes(keyCommand(key));
  return isDiff && immutable.includes(keySource(key));
}
function refreshesOnStatus(key: readonly unknown[]) {
  if (references.includes(keyCommand(key))) return false;
  return !isImmutableDiff(key);
}
type RepoEvent =
  'repo://status-changed' | 'repo://head-changed' | 'repo://files-changed';
const refreshRules: Record<RepoEvent, (key: readonly unknown[]) => boolean> = {
  'repo://status-changed': refreshesOnStatus,
  'repo://head-changed': () => true,
  'repo://files-changed': (key) => listings.includes(keyCommand(key)),
};
function refreshRepository(name: RepoEvent, repo: string) {
  void client.invalidateQueries({
    queryKey: [repo],
    predicate: (query) => refreshRules[name](query.queryKey),
  });
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
    const success = describeSuccess(command, {
      args: Object.fromEntries(Object.entries(args)),
      result: result,
      before: before,
    });
    if (success) useSuccesses.getState().announce(scope, success);
    return result;
  } finally {
    finish();
  }
}
export interface PerformOptions<K extends keyof Commands> {
  run?: (
    command: K,
    args: Commands[K]['args'],
  ) => Promise<Commands[K]['result']>;
  recover?: (failure: GitError) => unknown;
}
function reportFailure<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
  failure: GitError,
) {
  useErrors.getState().report(scopeOf(args), failure, {
    command: command,
    retry: () => perform(command, args),
  });
}
export async function perform<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
  options: PerformOptions<K> = {},
): Promise<Commands[K]['result'] | undefined> {
  const run = options.run ?? attempt;
  const recover =
    options.recover ??
    ((failure: GitError) => reportFailure(command, args, failure));
  try {
    const result = await run(command, args);
    useErrors.getState().resolve(scopeOf(args), command);
    return result;
  } catch (error) {
    await recover(normalizeError(error));
    return undefined;
  }
}
function invalidateApp(...commands: (keyof Commands)[]) {
  for (const command of commands)
    void client.invalidateQueries({ queryKey: ['app', command] });
}
function reportProgress({ repo, message }: Events['sync://progress']) {
  const progress = parseProgress(message);
  if (progress) useActivity.getState().progress(repo, progress);
}
type EventHandlers = { [K in keyof Events]?: (payload: Events[K]) => void };
const eventHandlers: EventHandlers = {
  'update://changed': () => invalidateApp('update_get'),
  'settings://changed': () => invalidateApp('settings_get', 'ai_models'),
  'repo://closed': ({ repo }) => client.removeQueries({ queryKey: [repo] }),
  'sync://progress': reportProgress,
  'repo://status-changed': ({ repo }) =>
    refreshRepository('repo://status-changed', repo),
  'repo://head-changed': ({ repo }) => {
    trimHistory(repo);
    refreshRepository('repo://head-changed', repo);
  },
  'repo://files-changed': ({ repo }) =>
    refreshRepository('repo://files-changed', repo),
};
export function handleEvent<K extends keyof Events>(
  name: K,
  payload: Events[K],
) {
  eventHandlers[name]?.(payload);
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
