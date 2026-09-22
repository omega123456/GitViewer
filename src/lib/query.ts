import { QueryClient, useQuery } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { invoke, normalizeError } from './ipc';
import type { Commands, Events } from './types';
import { appScope, useErrors } from '../stores/errors';
import { useTabs } from '../stores/tabs';
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
) {
  return useQuery({
    queryKey: queryKey(command, args),
    queryFn: () => invoke(command, args),
    enabled,
  });
}
export async function attempt<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
) {
  const store = useTabs.getState();
  store.setBusy(1);
  try {
    return await invoke(command, args);
  } finally {
    store.setBusy(-1);
  }
}
export async function perform<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
): Promise<Commands[K]['result'] | undefined> {
  const scope = 'repo' in args ? args.repo : appScope;
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
  } else if (payload && 'repo' in payload && name !== 'sync://progress') {
    void client.invalidateQueries({
      queryKey: [payload.repo],
      predicate: (query) =>
        name === 'repo://head-changed' ||
        ![
          'history',
          'commit_files',
          'compare_files',
          'default_branch',
        ].includes(String(query.queryKey[1])),
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
