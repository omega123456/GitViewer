import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  closedTab,
  editingElsewhere,
  emptyRepoSelection,
  findTab,
  forgotten,
  keptEditing,
  mostRecent,
  opened as openedSelection,
  overview,
  placedTab,
  repoSelection,
  tabKey,
  viewingAll,
  withHistoryPath,
  type FileTab,
  type SelectionState,
} from '../stores/selection/transitions';
import { layoutDefaults, updated } from '../stores/layout/transitions';
import {
  bufferIn,
  freshBuffer,
  isBufferProtected,
  patched,
  reconcile,
  withBuffer,
  withoutBuffer,
  withoutRepo,
  type EditorBuffers,
} from '../stores/editor/transitions';
import {
  applyReconciliation,
  current,
  openBuffer,
  useEditor,
} from '../stores/editor';
import type { Opened, Selection } from '../lib/types';

const USED_SECOND = 2;
const USED_THIRD = 3;
const USED_LATEST = 5;
const SHARED_SIDEBAR_WIDTH = 400;

const repo = 'one';
const staged: Selection = { path: 'a.ts', source: 'staged' };
const unstaged: Selection = { path: 'b.ts', source: 'unstaged' };
const editingB: Selection = { ...unstaged, editing: true };

function tab(selection: Selection, used: number): FileTab {
  return { selection: selection, used: used };
}

function withTabs(tabs: FileTab[], active?: Selection): SelectionState {
  return {
    repos: {
      [repo]: {
        ...emptyRepoSelection,
        current: { working: active },
        tabs: { working: tabs },
      },
    },
  };
}

it('keys tabs by source, revision, base and path', () => {
  expect(tabKey(staged)).toBe('staged:::a.ts');
  expect(
    tabKey({ path: 'c', source: 'compare', revision: 'r', base: 'b' }),
  ).toBe('compare:r:b:c');
});

it('opens the commit or compare stack for a pathless selection', () => {
  expect(overview('working', staged)).toBeUndefined();
  expect(overview('history', { path: '', source: 'commit' })).toBe('commit');
  expect(overview('compare', { path: '', source: 'compare' })).toBe('compare');
});

it('places a tab by appending, replacing, or leaving pathless selections out', () => {
  const first = tab(staged, 1);
  const fresh = tab(staged, USED_SECOND);
  expect(placedTab([], { opened: first, existing: undefined })).toEqual([
    first,
  ]);
  expect(placedTab([first], { opened: fresh, existing: first })).toEqual([
    fresh,
  ]);
  const pathless = tab({ path: '', source: 'commit' }, USED_THIRD);
  expect(placedTab([first], { opened: pathless, existing: undefined })).toEqual(
    [first],
  );
});

it('keeps editing on when a request leaves it unspecified', () => {
  const editingTab = tab(editingB, 1);
  expect(keptEditing(unstaged, editingTab)).toEqual(editingB);
  expect(keptEditing({ ...unstaged, editing: false }, editingTab)).toEqual({
    ...unstaged,
    editing: false,
  });
  expect(keptEditing(unstaged)).toBe(unstaged);
});

it('finds editing tabs in other modes and ignores the excepted tab', () => {
  const editingTab = tab(editingB, 1);
  const state = withTabs([editingTab, tab(staged, USED_SECOND)]);
  const selection = repoSelection(state, repo);
  expect(editingElsewhere(selection, 'b.ts')).toBe(true);
  expect(editingElsewhere(selection, 'b.ts', editingTab)).toBe(false);
  expect(editingElsewhere(selection, 'a.ts')).toBe(false);
  expect(findTab(selection, 'working', tabKey(staged))?.used).toBe(USED_SECOND);
  expect(findTab(selection, 'history', tabKey(staged))).toBeUndefined();
  expect(repoSelection({ repos: {} }, 'missing')).toBe(emptyRepoSelection);
});

it('picks the most recently used tab', () => {
  expect(mostRecent([tab(staged, 1), tab(unstaged, USED_LATEST)])?.used).toBe(
    USED_LATEST,
  );
  expect(mostRecent([])).toBeUndefined();
});

it('records an opened selection with its tabs and stack', () => {
  const tabs = [tab(staged, 1)];
  const next = openedSelection(
    { repos: {} },
    { id: repo, mode: 'working', selection: staged, tabs: tabs },
  );
  expect(next.repos[repo]?.current.working).toBe(staged);
  expect(next.repos[repo]?.tabs.working).toBe(tabs);
  expect(next.repos[repo]?.all).toBeUndefined();
});

it('closes an inactive tab without moving the selection', () => {
  const state = withTabs(
    [tab(staged, 1), tab(unstaged, USED_SECOND)],
    unstaged,
  );
  const next = closedTab(state, {
    id: repo,
    mode: 'working',
    tab: tab(staged, 1),
  });
  expect(next.repos[repo]?.tabs.working).toEqual([tab(unstaged, USED_SECOND)]);
  expect(next.repos[repo]?.current.working).toBe(unstaged);
});

it('moves to the most recent tab, or the overview, when the active tab closes', () => {
  const state = withTabs(
    [tab(staged, 1), tab(unstaged, USED_SECOND)],
    unstaged,
  );
  const next = closedTab(state, {
    id: repo,
    mode: 'working',
    tab: tab(unstaged, USED_SECOND),
  });
  expect(next.repos[repo]?.current.working).toBe(staged);
  const commit: Selection = { path: 'c', source: 'commit', revision: 'r' };
  const lonely = withTabs([tab(commit, 1)], commit);
  const emptied = closedTab(lonely, {
    id: repo,
    mode: 'working',
    tab: tab(commit, 1),
  });
  expect(emptied.repos[repo]?.current.working).toEqual({
    path: '',
    source: 'commit',
    revision: 'r',
    base: undefined,
  });
  expect(emptied.repos[repo]?.all).toBe('commit');
});

it('views every stack by clearing the right selection', () => {
  const state = withTabs([], { ...staged, revision: 'r' });
  const commit = viewingAll(state, {
    id: repo,
    mode: 'working',
    stack: 'commit',
  });
  expect(commit.repos[repo]?.current.working?.path).toBe('');
  expect(commit.repos[repo]?.all).toBe('commit');
  const none = viewingAll(
    { repos: {} },
    { id: repo, mode: 'history', stack: 'commit' },
  );
  expect(none.repos[repo]?.current.history).toBeUndefined();
  const compare = viewingAll(state, {
    id: repo,
    mode: 'compare',
    stack: 'compare',
  });
  expect(compare.repos[repo]?.current.compare).toBeUndefined();
  const working = viewingAll(state, {
    id: repo,
    mode: 'working',
    stack: 'unstaged',
  });
  expect(working.repos[repo]?.current.working).toBeUndefined();
  expect(working.repos[repo]?.all).toBe('unstaged');
});

it('sets the history path and forgets a repository in one step', () => {
  const state = withHistoryPath({ repos: {} }, repo, 'src');
  expect(state.repos[repo]?.path).toBe('src');
  expect(forgotten(state, repo).repos[repo]).toBeUndefined();
});

it('shares project-wide widths with siblings and keeps the rest per tab', () => {
  const next = updated(
    { tabs: {} },
    {
      id: 'a',
      siblings: ['a', 'b'],
      patch: { width: SHARED_SIDEBAR_WIDTH, filesOpen: true },
    },
  );
  expect(next.tabs.a).toEqual({
    ...layoutDefaults,
    width: SHARED_SIDEBAR_WIDTH,
    filesOpen: true,
  });
  expect(next.tabs.b).toEqual({
    ...layoutDefaults,
    width: SHARED_SIDEBAR_WIDTH,
  });
});

const editorKey = { repo: repo, path: 'a.ts' };
const editorOpened: Opened = {
  text: 'one',
  version: 'v1',
  bom: false,
  crlf: false,
};
const editorState = EditorState.create({ doc: 'one' });
const editorBuffer = freshBuffer(editorKey, editorOpened, editorState);

it('adds, patches and removes buffers', () => {
  const empty: EditorBuffers = { buffers: {} };
  const added = withBuffer(empty, editorKey, editorBuffer);
  expect(bufferIn(added, editorKey)).toBe(editorBuffer);
  expect(
    bufferIn(patched(added, editorKey, { dirty: true }), editorKey)?.dirty,
  ).toBe(true);
  expect(patched(empty, editorKey, { dirty: true })).toBe(empty);
  expect(bufferIn(withoutBuffer(added, editorKey), editorKey)).toBeUndefined();
  expect(withoutRepo(added, repo).buffers).toEqual({});
  expect(withoutBuffer(empty, editorKey).buffers[repo]).toEqual({});
});

it('protects buffers with edits, saves or conflicts', () => {
  expect(isBufferProtected(undefined)).toBe(false);
  expect(isBufferProtected(editorBuffer)).toBe(false);
  expect(isBufferProtected({ ...editorBuffer, dirty: true })).toBe(true);
  expect(isBufferProtected({ ...editorBuffer, saving: true })).toBe(true);
  expect(
    isBufferProtected({ ...editorBuffer, conflict: { current: null } }),
  ).toBe(true);
});

it('reconciles a buffer with the file on disk', () => {
  expect(reconcile(editorBuffer, editorOpened)).toEqual({ kind: 'unchanged' });
  const changed = { ...editorOpened, version: 'v2', text: 'two' };
  expect(reconcile(editorBuffer, changed)).toEqual({
    kind: 'reload',
    current: changed,
  });
  expect(reconcile({ ...editorBuffer, dirty: true }, changed)).toEqual({
    kind: 'conflict',
    current: changed,
  });
  expect(reconcile(editorBuffer, null)).toEqual({ kind: 'drop' });
});

it('applies each reconciliation to the stored buffer', () => {
  openBuffer(editorKey, editorOpened, editorState);
  applyReconciliation(editorKey, { kind: 'unchanged' });
  expect(current(editorKey)?.disk.version).toBe('v1');
  applyReconciliation(editorKey, { kind: 'conflict', current: null });
  expect(current(editorKey)?.conflict).toEqual({ current: null });
  const changed = { ...editorOpened, version: 'v2', text: 'two' };
  applyReconciliation(editorKey, { kind: 'reload', current: changed });
  expect(current(editorKey)?.disk.version).toBe('v2');
  expect(current(editorKey)?.state.doc.toString()).toBe('two');
  applyReconciliation(editorKey, { kind: 'drop' });
  expect(current(editorKey)).toBeUndefined();
  useEditor.setState({ buffers: {} });
});
