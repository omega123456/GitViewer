import { create } from 'zustand';
import type { Selection } from '../lib/types';
import { tabLayout, type SidebarMode } from './layout';
export type Group = 'staged' | 'unstaged';
export type Stack = Group | 'commit' | 'compare';
interface Selections {
  working: Record<string, Selection | undefined>;
  history: Record<string, Selection | undefined>;
  compare: Record<string, Selection | undefined>;
  all: Record<string, Stack | undefined>;
  paths: Record<string, string>;
  select: (id: string, selection: Selection) => void;
  viewAll: (id: string, stack: Stack) => void;
  setPath: (id: string, path: string) => void;
  forget: (id: string) => void;
}
function commitStack(state: Selections, id: string): Partial<Selections> {
  const mode = tabLayout(id).mode;
  return {
    [mode]: { ...state[mode], [id]: { ...state[mode][id]!, path: '' } },
  };
}
export const useSelection = create<Selections>((set) => ({
  working: {},
  history: {},
  compare: {},
  all: {},
  paths: {},
  select: (id, selection) =>
    set((s) => {
      const mode = tabLayout(id).mode;
      return {
        [mode]: { ...s[mode], [id]: selection },
        all: {
          ...s.all,
          [id]: selection.path
            ? undefined
            : mode === 'compare'
              ? 'compare'
              : 'commit',
        },
      };
    }),
  viewAll: (id, stack) =>
    set((s) => ({
      ...(stack === 'commit'
        ? commitStack(s, id)
        : stack === 'compare'
          ? { compare: { ...s.compare, [id]: undefined } }
          : { working: { ...s.working, [id]: undefined } }),
      all: { ...s.all, [id]: stack },
    })),
  setPath: (id, path) => set((s) => ({ paths: { ...s.paths, [id]: path } })),
  forget: (id) =>
    set((s) => ({
      working: { ...s.working, [id]: undefined },
      history: { ...s.history, [id]: undefined },
      compare: { ...s.compare, [id]: undefined },
      all: { ...s.all, [id]: undefined },
      paths: { ...s.paths, [id]: '' },
    })),
}));
export function useCurrentSelection(id: string, mode: SidebarMode) {
  return useSelection((s) => s[mode][id]);
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
