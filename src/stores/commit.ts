import { create } from 'zustand';
import { repoStateUpdater } from './repo-state';
import type { CommitMode } from './tabs';
export type CommitPhase = 'idle' | 'committing' | 'pushing';
export interface CommitState {
  phase: CommitPhase;
  prompt: CommitMode | null;
}
const idle: CommitState = { phase: 'idle', prompt: null };
interface CommitStore {
  repos: Record<string, CommitState>;
  ask: (repo: string, mode: CommitMode) => void;
  dismiss: (repo: string) => void;
  begin: (repo: string) => void;
  enter: (repo: string, phase: CommitPhase) => void;
}
export const useCommit = create<CommitStore>(() => ({
  repos: {},
  ask: (repo, mode) => update(repo, { prompt: mode }),
  dismiss: (repo) => update(repo, { prompt: null }),
  begin: (repo) => update(repo, { phase: 'committing', prompt: null }),
  enter: (repo, phase) => update(repo, { phase: phase }),
}));
const update = repoStateUpdater(useCommit, idle);
export function useCommitState(repo: string) {
  return useCommit((state) => state.repos[repo]) ?? idle;
}
