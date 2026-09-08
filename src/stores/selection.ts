import { create } from 'zustand';
import type { Selection } from '../lib/types';
import { tabLayout } from './layout';
interface Selections {
  working: Record<string, Selection | undefined>;
  history: Record<string, Selection | undefined>;
  paths: Record<string, string>;
  select: (id: string, selection: Selection) => void;
  setPath: (id: string, path: string) => void;
  forget: (id: string) => void;
}
export const useSelection = create<Selections>((set) => ({
  working: {},
  history: {},
  paths: {},
  select: (id, selection) =>
    set((s) =>
      tabLayout(id).history
        ? { history: { ...s.history, [id]: selection } }
        : { working: { ...s.working, [id]: selection } },
    ),
  setPath: (id, path) => set((s) => ({ paths: { ...s.paths, [id]: path } })),
  forget: (id) =>
    set((s) => ({
      working: { ...s.working, [id]: undefined },
      history: { ...s.history, [id]: undefined },
      paths: { ...s.paths, [id]: '' },
    })),
}));
export function useCurrentSelection(id: string, history: boolean) {
  return useSelection((s) => (history ? s.history[id] : s.working[id]));
}
export function useWorkingSelection(id: string) {
  return useSelection((s) => s.working[id]);
}
export function useHistoryPath(id: string) {
  return useSelection((s) => s.paths[id] ?? '');
}
