import { create } from 'zustand';
import type { Selection } from '../lib/types';
import { tabLayout } from './layout';
export type Group = 'staged' | 'unstaged';
interface Selections {
  working: Record<string, Selection | undefined>;
  history: Record<string, Selection | undefined>;
  all: Record<string, Group | undefined>;
  paths: Record<string, string>;
  select: (id: string, selection: Selection) => void;
  viewAll: (id: string, group: Group) => void;
  setPath: (id: string, path: string) => void;
  forget: (id: string) => void;
}
export const useSelection = create<Selections>((set) => ({
  working: {},
  history: {},
  all: {},
  paths: {},
  select: (id, selection) =>
    set((s) =>
      tabLayout(id).history
        ? { history: { ...s.history, [id]: selection } }
        : {
            working: { ...s.working, [id]: selection },
            all: { ...s.all, [id]: undefined },
          },
    ),
  viewAll: (id, group) =>
    set((s) => ({
      working: { ...s.working, [id]: undefined },
      all: { ...s.all, [id]: group },
    })),
  setPath: (id, path) => set((s) => ({ paths: { ...s.paths, [id]: path } })),
  forget: (id) =>
    set((s) => ({
      working: { ...s.working, [id]: undefined },
      history: { ...s.history, [id]: undefined },
      all: { ...s.all, [id]: undefined },
      paths: { ...s.paths, [id]: '' },
    })),
}));
export function useCurrentSelection(id: string, history: boolean) {
  return useSelection((s) => (history ? s.history[id] : s.working[id]));
}
export function useWorkingSelection(id: string) {
  return useSelection((s) => s.working[id]);
}
export function useAllChanges(id: string) {
  return useSelection((s) => s.all[id]);
}
export function useHistoryPath(id: string) {
  return useSelection((s) => s.paths[id] ?? '');
}
