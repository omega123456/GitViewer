import { create } from 'zustand';
import { invoke, normalizeError } from '../lib/ipc';
import type { GeneratedMessage } from '../lib/types';
import { withEntry } from '../lib/record';
import { useTabs } from './tabs';
export type Generation =
  | { kind: 'running' }
  | { kind: 'applied'; applied: GeneratedMessage }
  | { kind: 'failed'; error: string };
interface Generate {
  repos: Record<string, Generation | null>;
  generate: (repo: string) => Promise<void>;
}
const running: Generation = { kind: 'running' };
function record(repo: string, generation: Generation) {
  useGenerate.setState((state) => ({
    repos: withEntry(state.repos, repo, generation),
  }));
}
export const useGenerate = create<Generate>(() => ({
  repos: {},
  generate: async (repo) => {
    record(repo, running);
    try {
      const result = await invoke('ai_generate', { repo });
      useTabs.getState().setMessage(repo, result.message);
      record(repo, { kind: 'applied', applied: result });
    } catch (error) {
      record(repo, { kind: 'failed', error: normalizeError(error).message });
    }
  },
}));
export function useGeneration(repo: string) {
  return useGenerate((state) => state.repos[repo] ?? null);
}
export function isGenerating(generation: Generation | null) {
  return generation?.kind === 'running';
}
export function appliedMessage(generation: Generation | null) {
  return generation?.kind === 'applied' ? generation.applied : null;
}
export function generationError(generation: Generation | null) {
  return generation?.kind === 'failed' ? generation.error : null;
}
