import type { Selection } from '../../lib/types';
import { without, withEntry } from '../../lib/record';
import type { SidebarMode } from '../layout';
export type Group = 'staged' | 'unstaged';
export type Stack = Group | 'commit' | 'compare';
export interface FileTab {
  selection: Selection;
  used: number;
}
type PerMode<T> = Partial<Record<SidebarMode, T>>;
export interface RepoSelection {
  current: PerMode<Selection>;
  all: Stack | undefined;
  path: string;
  tabs: PerMode<FileTab[]>;
}
export interface SelectionState {
  repos: Record<string, RepoSelection | undefined>;
}
export interface Opening {
  id: string;
  mode: SidebarMode;
  selection: Selection;
  tabs: FileTab[];
}
export interface TabClosing {
  id: string;
  mode: SidebarMode;
  tab: FileTab;
}
export interface AllChangesView {
  id: string;
  mode: SidebarMode;
  stack: Stack;
}
export interface TabPlacement {
  opened: FileTab;
  existing: FileTab | undefined;
}
const modes: SidebarMode[] = ['working', 'history', 'compare'];
export const emptyRepoSelection: RepoSelection = {
  current: {},
  all: undefined,
  path: '',
  tabs: {},
};
export function tabKey(selection: Selection) {
  return `${selection.source}:${selection.revision ?? ''}:${selection.base ?? ''}:${selection.path}`;
}
export function repoSelection(state: SelectionState, id: string) {
  return state.repos[id] ?? emptyRepoSelection;
}
function withRepo(
  state: SelectionState,
  id: string,
  change: (repo: RepoSelection) => RepoSelection,
): SelectionState {
  return {
    repos: withEntry(state.repos, id, change(repoSelection(state, id))),
  };
}
export function overview(
  mode: SidebarMode,
  selection: Selection,
): Stack | undefined {
  if (selection.path) return undefined;
  return mode === 'compare' ? 'compare' : 'commit';
}
export function findTab(repo: RepoSelection, mode: SidebarMode, key: string) {
  return (repo.tabs[mode] ?? []).find((tab) => tabKey(tab.selection) === key);
}
function isEditingTab(tab: FileTab, path: string, except?: FileTab) {
  const editing = Boolean(tab.selection.editing);
  return tab !== except && editing && tab.selection.path === path;
}
export function editingElsewhere(
  repo: RepoSelection,
  path: string,
  except?: FileTab,
) {
  return modes.some((mode) =>
    (repo.tabs[mode] ?? []).some((tab) => isEditingTab(tab, path, except)),
  );
}
export function keptEditing(requested: Selection, current?: FileTab) {
  const stillEditing =
    Boolean(current?.selection.editing) && requested.editing === undefined;
  return stillEditing ? { ...requested, editing: true } : requested;
}
export function placedTab(tabs: FileTab[], placement: TabPlacement) {
  const { opened, existing } = placement;
  if (!opened.selection.path) return tabs;
  if (!existing) return [...tabs, opened];
  return tabs.map((tab) => (tab === existing ? opened : tab));
}
export function mostRecent(tabs: FileTab[]) {
  return [...tabs].sort((left, right) => right.used - left.used)[0];
}
function selectedIn(
  repo: RepoSelection,
  mode: SidebarMode,
  selection: Selection,
): RepoSelection {
  return {
    ...repo,
    current: { ...repo.current, [mode]: selection },
    all: overview(mode, selection),
  };
}
function withModeTabs(
  repo: RepoSelection,
  mode: SidebarMode,
  tabs: FileTab[],
): RepoSelection {
  return { ...repo, tabs: { ...repo.tabs, [mode]: tabs } };
}
export function opened(
  state: SelectionState,
  opening: Opening,
): SelectionState {
  const { id, mode, selection, tabs } = opening;
  return withRepo(state, id, (repo) =>
    withModeTabs(selectedIn(repo, mode, selection), mode, tabs),
  );
}
function isActiveTab(active: Selection | undefined, key: string) {
  if (!active?.path) return false;
  return tabKey(active) === key;
}
function overviewOf(selection: Selection): Selection {
  return {
    path: '',
    source: selection.source,
    revision: selection.revision,
    base: selection.base,
  };
}
export function closedTab(
  state: SelectionState,
  closing: TabClosing,
): SelectionState {
  const { id, mode, tab } = closing;
  const key = tabKey(tab.selection);
  return withRepo(state, id, (repo) => {
    const rest = (repo.tabs[mode] ?? []).filter(
      (open) => tabKey(open.selection) !== key,
    );
    const remaining = withModeTabs(repo, mode, rest);
    if (!isActiveTab(repo.current[mode], key)) return remaining;
    const selection = mostRecent(rest)?.selection ?? overviewOf(tab.selection);
    return selectedIn(remaining, mode, selection);
  });
}
type Current = RepoSelection['current'];
function withoutPath(current: Current, mode: SidebarMode): Current {
  const selection = current[mode];
  if (!selection) return current;
  return { ...current, [mode]: { ...selection, path: '' } };
}
const allChangesCurrent: Record<
  Stack,
  (current: Current, mode: SidebarMode) => Current
> = {
  commit: withoutPath,
  compare: (current) => ({ ...current, compare: undefined }),
  staged: (current) => ({ ...current, working: undefined }),
  unstaged: (current) => ({ ...current, working: undefined }),
};
export function viewingAll(
  state: SelectionState,
  view: AllChangesView,
): SelectionState {
  const { id, mode, stack } = view;
  return withRepo(state, id, (repo) => ({
    ...repo,
    current: allChangesCurrent[stack](repo.current, mode),
    all: stack,
  }));
}
export function withHistoryPath(
  state: SelectionState,
  id: string,
  path: string,
): SelectionState {
  return withRepo(state, id, (repo) => ({ ...repo, path: path }));
}
export function forgotten(state: SelectionState, id: string): SelectionState {
  return { repos: without(state.repos, id) };
}
