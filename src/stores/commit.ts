import { create } from 'zustand';
import { perform } from '../lib/query';
import { type CommitMode, useTabs } from './tabs';
export type CommitPhase = 'idle' | 'committing' | 'pushing';
export interface CommitState {
  phase: CommitPhase;
  prompt: CommitMode | null;
  notice: string | null;
}
export interface CommitRequest {
  message: string;
  mode: CommitMode;
  stage: string[];
}
const idle: CommitState = { phase: 'idle', prompt: null, notice: null };
interface CommitStore {
  repos: Record<string, CommitState>;
  ask: (repo: string, mode: CommitMode) => void;
  dismiss: (repo: string) => void;
  run: (repo: string, request: CommitRequest) => Promise<void>;
}
function update(repo: string, patch: Partial<CommitState>) {
  useCommit.setState((state) => ({
    repos: {
      ...state.repos,
      [repo]: { ...(state.repos[repo] ?? idle), ...patch },
    },
  }));
}
export const useCommit = create<CommitStore>(() => ({
  repos: {},
  ask: (repo, mode) => update(repo, { prompt: mode, notice: null }),
  dismiss: (repo) => update(repo, { prompt: null }),
  run: async (repo, { message, mode, stage }) => {
    update(repo, { phase: 'committing', prompt: null, notice: null });
    const staged =
      stage.length === 0 ||
      (await perform('files_action', {
        repo,
        paths: stage,
        action: 'stage',
      })) !== undefined;
    const committed =
      staged && (await perform('commit', { repo, message })) !== undefined;
    if (!committed) {
      update(repo, { phase: 'idle' });
      return;
    }
    useTabs.getState().setMessage(repo, '');
    if (mode === 'commitPush') {
      update(repo, { phase: 'pushing' });
      const pushed = await perform('sync', { repo, action: 'push' });
      if (pushed === undefined) {
        const reason = useTabs.getState().error?.message ?? 'unknown error';
        update(repo, { notice: `Committed. Push failed: ${reason}` });
      }
    }
    update(repo, { phase: 'idle' });
  },
}));
export function useCommitState(repo: string) {
  return useCommit((state) => state.repos[repo]) ?? idle;
}
