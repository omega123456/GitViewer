import { create } from 'zustand';
import { invoke, normalizeError } from '../lib/ipc';
import type { GeneratedMessage } from '../lib/types';
import { repoStateUpdater } from './repo-state';
import { useTabs } from './tabs';
export interface GenerateState {
  busy: boolean;
  error: string | null;
  applied: GeneratedMessage | null;
}
const idle: GenerateState = {
  busy: false,
  error: null,
  applied: null,
};
interface Generate {
  repos: Record<string, GenerateState>;
  generate: (repo: string) => Promise<void>;
}
export const useGenerate = create<Generate>(() => ({
  repos: {},
  generate: async (repo) => {
    update(repo, { busy: true, error: null, applied: null });
    try {
      const result = await invoke('ai_generate', { repo });
      useTabs.getState().setMessage(repo, result.message);
      update(repo, { busy: false, applied: result });
    } catch (error) {
      update(repo, { busy: false, error: normalizeError(error).message });
    }
  },
}));
const update = repoStateUpdater(useGenerate, idle);
export function useGenerateState(repo: string) {
  return useGenerate((state) => state.repos[repo]) ?? idle;
}
