import { create } from 'zustand';
import { invoke, normalizeError } from '../lib/ipc';
import type { GeneratedMessage } from '../lib/types';
import { useTabs } from './tabs';
export interface GenerateState {
  busy: boolean;
  error: string | null;
  pending: GeneratedMessage | null;
  applied: GeneratedMessage | null;
}
const idle: GenerateState = {
  busy: false,
  error: null,
  pending: null,
  applied: null,
};
interface Generate {
  repos: Record<string, GenerateState>;
  generate: (repo: string) => Promise<void>;
  confirm: (repo: string) => void;
  dismiss: (repo: string) => void;
}
function update(repo: string, patch: Partial<GenerateState>) {
  useGenerate.setState((state) => ({
    repos: {
      ...state.repos,
      [repo]: { ...(state.repos[repo] ?? idle), ...patch },
    },
  }));
}
export const useGenerate = create<Generate>(() => ({
  repos: {},
  generate: async (repo) => {
    update(repo, { busy: true, error: null, pending: null, applied: null });
    try {
      const result = await invoke('ai_generate', { repo });
      const draft = useTabs
        .getState()
        .tabs.find((tab) => tab.id === repo)
        ?.message.trim();
      if (draft) {
        update(repo, { busy: false, pending: result });
        return;
      }
      useTabs.getState().setMessage(repo, result.message);
      update(repo, { busy: false, applied: result });
    } catch (error) {
      update(repo, { busy: false, error: normalizeError(error).message });
    }
  },
  confirm: (repo) => {
    const pending = useGenerate.getState().repos[repo]!.pending!;
    useTabs.getState().setMessage(repo, pending.message);
    update(repo, { pending: null, applied: pending });
  },
  dismiss: (repo) => update(repo, { pending: null }),
}));
export function useGenerateState(repo: string) {
  return useGenerate((state) => state.repos[repo]) ?? idle;
}
