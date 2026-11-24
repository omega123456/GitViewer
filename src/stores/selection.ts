import { create } from 'zustand';
import type { Selection } from '../lib/types';
import { approveDiscard, current, drop, dropRepo, isProtected } from './editor';
import { tabLayout, type SidebarMode } from './layout';
import { stepIndex } from '../lib/list';
import { fileTabLimit } from '../lib/settings';
import {
  closedTab,
  editingElsewhere,
  findTab,
  forgotten,
  keptEditing,
  opened,
  placedTab,
  repoSelection,
  tabKey,
  viewingAll,
  withHistoryPath,
  type FileTab,
  type SelectionState,
  type Stack,
} from './selection/transitions';
export type { FileTab, Group, Stack } from './selection/transitions';
export { tabKey } from './selection/transitions';
export interface TabStep {
  mode: SidebarMode;
  direction: number;
}
interface Selections extends SelectionState {
  select: (id: string, selection: Selection) => void;
  viewAll: (id: string, stack: Stack) => void;
  setPath: (id: string, path: string) => void;
  closeTab: (id: string, mode: SidebarMode, key: string) => Promise<void>;
  cycleTab: (id: string, step: TabStep) => void;
  forget: (id: string) => void;
}
interface TabRequest {
  id: string;
  mode: SidebarMode;
  selection: Selection;
}
const noTabs: FileTab[] = [];
let clock = 0;
function repoOf(id: string) {
  return repoSelection(useSelection.getState(), id);
}
function release(id: string, path: string) {
  if (!editingElsewhere(repoOf(id), path)) drop({ repo: id, path: path });
}
function isClosable(id: string, tab: FileTab) {
  const editing = Boolean(tab.selection.editing);
  return !(editing && isProtected({ repo: id, path: tab.selection.path }));
}
function oldestClean(id: string, tabs: FileTab[], kept: FileTab) {
  return tabs
    .filter((tab) => tab !== kept && isClosable(id, tab))
    .sort((left, right) => left.used - right.used)
    .slice(0, Math.max(0, tabs.length - fileTabLimit()));
}
const pendingLeave = new Map<string, () => void>();
function guarded(id: string, leaving: string | undefined, apply: () => void) {
  if (leaving === undefined) return apply();
  const leave = () => {
    apply();
    release(id, leaving);
  };
  const file = { repo: id, path: leaving };
  if (!current(file)?.dirty) return leave();
  const asking = pendingLeave.has(id);
  pendingLeave.set(id, leave);
  if (asking) return;
  void approveDiscard(file)
    .catch(() => false)
    .then((approved) => {
      const latest = pendingLeave.get(id);
      pendingLeave.delete(id);
      if (approved) latest?.();
    });
}
function openTab(request: TabRequest) {
  const { id, mode, selection } = request;
  const repo = repoOf(id);
  const existing = findTab(repo, mode, tabKey(selection));
  const fresh = { selection: selection, used: ++clock };
  const tabs = placedTab(repo.tabs[mode] ?? [], {
    opened: fresh,
    existing: existing,
  });
  const isNewFile = Boolean(selection.path) && !existing;
  const closing = isNewFile ? oldestClean(id, tabs, fresh) : [];
  const kept = tabs.filter((tab) => !closing.includes(tab));
  useSelection.setState((state) =>
    opened(state, { id: id, mode: mode, selection: selection, tabs: kept }),
  );
  for (const tab of closing) release(id, tab.selection.path);
}
function leavingPath(id: string, selection: Selection, current?: FileTab) {
  const stopsEditing =
    Boolean(current?.selection.editing) && !selection.editing;
  const editedElsewhere = editingElsewhere(repoOf(id), selection.path, current);
  return stopsEditing && !editedElsewhere ? selection.path : undefined;
}
function selectFile(id: string, requested: Selection) {
  const mode = tabLayout(id).mode;
  const current = findTab(repoOf(id), mode, tabKey(requested));
  const selection = keptEditing(requested, current);
  const leaving = leavingPath(id, selection, current);
  guarded(id, leaving, () =>
    openTab({ id: id, mode: mode, selection: selection }),
  );
}
async function approvedToClose(id: string, tab: FileTab) {
  const { path, editing } = tab.selection;
  const asksFirst =
    Boolean(editing) && !editingElsewhere(repoOf(id), path, tab);
  if (!asksFirst) return true;
  return approveDiscard({ repo: id, path: path });
}
async function closeFileTab(id: string, mode: SidebarMode, key: string) {
  const tab = findTab(repoOf(id), mode, key);
  if (!tab) return;
  const approved = await approvedToClose(id, tab);
  if (!approved) return;
  const { path } = tab.selection;
  useSelection.setState((state) =>
    closedTab(state, { id: id, mode: mode, tab: tab }),
  );
  release(id, path);
}
function cycleFileTab(id: string, step: TabStep) {
  const tabs = fileTabsOf(id, step.mode);
  const active = selectionOf(id, step.mode);
  const activeKey = active?.path ? tabKey(active) : undefined;
  const index = tabs.findIndex((tab) => tabKey(tab.selection) === activeKey);
  const next = tabs[stepIndex(index, step.direction, tabs.length)];
  if (next) selectFile(id, next.selection);
}
export const useSelection = create<Selections>((set) => ({
  repos: {},
  select: selectFile,
  viewAll: (id, stack) =>
    set((state) =>
      viewingAll(state, { id: id, mode: tabLayout(id).mode, stack: stack }),
    ),
  setPath: (id, path) => set((state) => withHistoryPath(state, id, path)),
  closeTab: closeFileTab,
  cycleTab: cycleFileTab,
  forget: (id) => {
    dropRepo(id);
    set((state) => forgotten(state, id));
  },
}));
export function selectionOf(id: string, mode: SidebarMode) {
  return repoOf(id).current[mode];
}
export function allChangesOf(id: string) {
  return repoOf(id).all;
}
export function historyPathOf(id: string) {
  return repoOf(id).path;
}
export function fileTabsOf(id: string, mode: SidebarMode) {
  return repoOf(id).tabs[mode] ?? noTabs;
}
export function useCurrentSelection(id: string, mode: SidebarMode) {
  return useSelection((state) => state.repos[id]?.current[mode]);
}
export function useWorkingSelection(id: string) {
  return useCurrentSelection(id, 'working');
}
export function useAllChanges(id: string) {
  return useSelection((state) => state.repos[id]?.all);
}
export function useHistoryPath(id: string) {
  return useSelection((state) => state.repos[id]?.path ?? '');
}
export function useFileTabs(id: string, mode: SidebarMode) {
  return useSelection((state) => state.repos[id]?.tabs[mode] ?? noTabs);
}
export function useActiveTabKey(id: string, mode: SidebarMode) {
  return useSelection((state) => {
    const active = state.repos[id]?.current[mode];
    return active?.path ? tabKey(active) : '';
  });
}
export function stopEditing(id: string) {
  const selection = selectionOf(id, tabLayout(id).mode);
  if (selection?.editing) selectFile(id, { ...selection, editing: false });
}
