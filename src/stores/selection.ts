import { create } from 'zustand';
import type { Selection } from '../lib/types';
import { approveDiscard, drop, useEditor } from './editor';
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
const pendingLeave = new Map<string, () => void>();
function guarded(id: string, leaving: boolean, apply: () => void) {
  if (!leaving) return apply();
  const leave = () => {
    apply();
    drop(id);
  };
  if (!useEditor.getState().buffers[id]?.dirty) return leave();
  const asking = pendingLeave.has(id);
  pendingLeave.set(id, leave);
  if (asking) return;
  void approveDiscard(id)
    .catch(() => false)
    .then((approved) => {
      const latest = pendingLeave.get(id);
      pendingLeave.delete(id);
      if (approved) latest?.();
    });
}
function commitStack(state: Selections, id: string): Partial<Selections> {
  const mode = tabLayout(id).mode;
  return {
    [mode]: { ...state[mode], [id]: { ...state[mode][id]!, path: '' } },
  };
}
export const useSelection = create<Selections>((set, get) => ({
  working: {},
  history: {},
  compare: {},
  all: {},
  paths: {},
  select: (id, requested) => {
    const mode = tabLayout(id).mode;
    const previous = get()[mode][id];
    const same =
      previous?.path === requested.path && previous.source === requested.source;
    const selection =
      same && previous.editing && requested.editing === undefined
        ? { ...requested, editing: true }
        : requested;
    guarded(
      id,
      Boolean(previous?.editing) && !(same && selection.editing),
      () =>
        set((s) => ({
          [mode]: { ...s[mode], [id]: selection },
          all: {
            ...s.all,
            [id]: selection.path
              ? undefined
              : mode === 'compare'
                ? 'compare'
                : 'commit',
          },
        })),
    );
  },
  viewAll: (id, stack) =>
    guarded(
      id,
      ['staged', 'unstaged'].includes(stack) &&
        Boolean(get().working[id]?.editing),
      () =>
        set((s) => ({
          ...(stack === 'commit'
            ? commitStack(s, id)
            : stack === 'compare'
              ? { compare: { ...s.compare, [id]: undefined } }
              : { working: { ...s.working, [id]: undefined } }),
          all: { ...s.all, [id]: stack },
        })),
    ),
  setPath: (id, path) => set((s) => ({ paths: { ...s.paths, [id]: path } })),
  forget: (id) => {
    drop(id);
    set((s) => ({
      working: { ...s.working, [id]: undefined },
      history: { ...s.history, [id]: undefined },
      compare: { ...s.compare, [id]: undefined },
      all: { ...s.all, [id]: undefined },
      paths: { ...s.paths, [id]: '' },
    }));
  },
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
export function stopEditing(id: string) {
  const store = useSelection.getState();
  const selection = store[tabLayout(id).mode][id];
  if (selection?.editing) store.select(id, { ...selection, editing: false });
}
