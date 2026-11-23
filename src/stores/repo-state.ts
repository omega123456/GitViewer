import type { StoreApi } from 'zustand';
import { withEntry } from '../lib/record';
export interface RepoStates<T> {
  repos: Record<string, T>;
}
export function repoStateUpdater<T, State extends RepoStates<T>>(
  store: StoreApi<State>,
  idle: T,
) {
  return (repo: string, patch: Partial<T>) =>
    store.setState((state) => ({
      ...state,
      repos: withEntry(state.repos, repo, {
        ...(state.repos[repo] ?? idle),
        ...patch,
      }),
    }));
}
