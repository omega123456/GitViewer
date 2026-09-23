import { QueryClient, useQuery } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { invoke, normalizeError } from './ipc';
import type { Commands, Events } from './types';
import { parseProgress } from './activity';
import { track, useActivity } from '../stores/activity';
import { appScope, useErrors } from '../stores/errors';
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
function refreshes(name: string, key: readonly unknown[]) {
  const [, command, args] = key as [unknown, string, { source?: string }?];
  if (name === 'repo://head-changed') return true;
  if (
    ['history', 'commit_files', 'compare_files', 'default_branch'].includes(
      command,
    )
  )
    return false;
  return !(
    ['diff', 'diff_stack'].includes(command) &&
    immutable.includes(String(args?.source))
  );
}
function scopeOf(args: object) {
  return 'repo' in args ? String(args.repo) : appScope;
}
export async function attempt<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
) {
  const finish = track(scopeOf(args), command, args);
  try {
    return await invoke(command, args);
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
