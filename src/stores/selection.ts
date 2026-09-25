import { create } from 'zustand';
import { client, queryKey } from '../lib/query';
import type { Selection, SettingsResponse } from '../lib/types';
import { approveDiscard, drop, isProtected, useEditor } from './editor';
import { tabLayout, type SidebarMode } from './layout';
export type Group = 'staged' | 'unstaged';
export type Stack = Group | 'commit' | 'compare';
export interface FileTab {
  selection: Selection;
  used: number;
}
type Tabs = Record<SidebarMode, Record<string, FileTab[] | undefined>>;
interface Selections {
  working: Record<string, Selection | undefined>;
  history: Record<string, Selection | undefined>;
  compare: Record<string, Selection | undefined>;
  all: Record<string, Stack | undefined>;
  paths: Record<string, string>;
  tabs: Tabs;
  select: (id: string, selection: Selection) => void;
  viewAll: (id: string, stack: Stack) => void;
  setPath: (id: string, path: string) => void;
  closeTab: (id: string, mode: SidebarMode, key: string) => Promise<void>;
  cycleTab: (id: string, mode: SidebarMode, direction: number) => void;
  forget: (id: string) => void;
}
const modes: SidebarMode[] = ['working', 'history', 'compare'];
const noTabs: FileTab[] = [];
let clock = 0;
export function tabKey(selection: Selection) {
  return `${selection.source}:${selection.revision ?? ''}:${selection.base ?? ''}:${selection.path}`;
}
function tabLimit() {
  return (
    client.getQueryData<SettingsResponse>(queryKey('settings_get', {}))
      ?.maxFileTabs ?? 8
  );
}
function overview(mode: SidebarMode, selection: Selection): Stack | undefined {
  if (selection.path) return undefined;
  return mode === 'compare' ? 'compare' : 'commit';
}
function editingElsewhere(id: string, path: string, except?: FileTab) {
  const { tabs } = useSelection.getState();
  return modes.some((mode) =>
    (tabs[mode][id] ?? []).some(
      (tab) =>
        tab !== except && tab.selection.editing && tab.selection.path === path,
    ),
  );
}
function release(id: string, path: string) {
  if (!editingElsewhere(id, path)) drop(id, path);
}
function oldestClean(id: string, tabs: FileTab[], opened: FileTab) {
  return tabs
    .filter(
      (tab) =>
        tab !== opened &&
        !(tab.selection.editing && isProtected(id, tab.selection.path)),
    )
    .sort((a, b) => a.used - b.used)
    .slice(0, Math.max(0, tabs.length - tabLimit()));
}
const pendingLeave = new Map<string, () => void>();
function guarded(id: string, leaving: string | undefined, apply: () => void) {
  if (leaving === undefined) return apply();
  const leave = () => {
    apply();
    release(id, leaving);
  };
  if (!useEditor.getState().buffers[id]?.[leaving]?.dirty) return leave();
  const asking = pendingLeave.has(id);
  pendingLeave.set(id, leave);
  if (asking) return;
  void approveDiscard(id, leaving)
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
  tabs: { working: {}, history: {}, compare: {} },
  select: (id, requested) => {
    const mode = tabLayout(id).mode;
    const key = tabKey(requested);
    const find = () =>
      (get().tabs[mode][id] ?? []).find((tab) => tabKey(tab.selection) === key);
    const current = find();
    const was = current?.selection.editing;
    const selection =
      was && requested.editing === undefined
        ? { ...requested, editing: true }
        : requested;
    const leaving =
      was &&
      !selection.editing &&
      !editingElsewhere(id, requested.path, current)
        ? requested.path
        : undefined;
    guarded(id, leaving, () => {
      const list = get().tabs[mode][id] ?? [];
      const existing = find();
      const opened = { selection, used: ++clock };
      const next = !selection.path
        ? list
        : existing
          ? list.map((tab) => (tab === existing ? opened : tab))
          : [...list, opened];
      const closing =
        selection.path && !existing ? oldestClean(id, next, opened) : [];
      set((s) => ({
        [mode]: { ...s[mode], [id]: selection },
        all: { ...s.all, [id]: overview(mode, selection) },
        tabs: {
          ...s.tabs,
          [mode]: {
            ...s.tabs[mode],
            [id]: next.filter((tab) => !closing.includes(tab)),
          },
        },
      }));
      for (const tab of closing) release(id, tab.selection.path);
    });
  },
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
  closeTab: async (id, mode, key) => {
    const tab = get().tabs[mode][id]?.find(
      (tab) => tabKey(tab.selection) === key,
    );
    if (!tab) return;
    const { path, editing } = tab.selection;
    if (
      editing &&
      !editingElsewhere(id, path, tab) &&
      !(await approveDiscard(id, path))
    )
      return;
    set((s) => {
      const rest = (s.tabs[mode][id] ?? []).filter(
        (open) => tabKey(open.selection) !== key,
      );
      const active = s[mode][id];
      const tabs = { ...s.tabs, [mode]: { ...s.tabs[mode], [id]: rest } };
      if (!active?.path || tabKey(active) !== key) return { tabs };
      const recent = [...rest].sort((a, b) => b.used - a.used)[0];
      const selection = recent?.selection ?? {
        path: '',
        source: tab.selection.source,
        revision: tab.selection.revision,
        base: tab.selection.base,
      };
      return {
        tabs,
        [mode]: { ...s[mode], [id]: selection },
        all: { ...s.all, [id]: overview(mode, selection) },
      };
    });
    release(id, path);
  },
  cycleTab: (id, mode, direction) => {
    const tabs = get().tabs[mode][id] ?? [];
    const active = get()[mode][id];
    const index = tabs.findIndex(
      (tab) => active?.path && tabKey(tab.selection) === tabKey(active),
    );
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    if (next) get().select(id, next.selection);
  },
  forget: (id) => {
    drop(id);
    set((s) => ({
      working: { ...s.working, [id]: undefined },
      history: { ...s.history, [id]: undefined },
      compare: { ...s.compare, [id]: undefined },
      all: { ...s.all, [id]: undefined },
      paths: { ...s.paths, [id]: '' },
      tabs: {
        working: { ...s.tabs.working, [id]: undefined },
        history: { ...s.tabs.history, [id]: undefined },
        compare: { ...s.tabs.compare, [id]: undefined },
      },
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
export function useFileTabs(id: string, mode: SidebarMode) {
  return useSelection((s) => s.tabs[mode][id] ?? noTabs);
}
export function useActiveTabKey(id: string, mode: SidebarMode) {
  return useSelection((s) => {
    const active = s[mode][id];
    return active?.path ? tabKey(active) : '';
  });
}
export function stopEditing(id: string) {
  const store = useSelection.getState();
  const selection = store[tabLayout(id).mode][id];
  if (selection?.editing) store.select(id, { ...selection, editing: false });
}
