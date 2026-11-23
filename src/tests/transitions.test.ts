import { describe, expect, it } from 'vitest';
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
import {
  activated,
  closed,
  cycled,
  departed,
  joined,
  opened as openedTab,
  shown,
  touched,
  type TabsState,
} from '../stores/tabs/transitions';
import {
  edited,
  progressed,
  started,
  type Activity,
} from '../stores/activity/transitions';
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
import {
  appliedMessage,
  generationError,
  isGenerating,
} from '../stores/generate';
import { relabeled, type Failure } from '../stores/errors';
import { announced, type Notice } from '../stores/successes';
import type { Opened, Selection } from '../lib/types';
import { generated } from './fixtures';

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

describe('selection transitions', () => {
  it('keys tabs by source, revision, base and path', () => {
    expect(tabKey(staged)).toBe('staged:::a.ts');
    expect(
      tabKey({ path: 'c', source: 'compare', revision: 'r', base: 'b' }),
    ).toBe('compare:r:b:c');
  });
  it('opens the commit or compare stack for a pathless selection', () => {
    expect(overview('working', staged)).toBeUndefined();
    expect(overview('history', { path: '', source: 'commit' })).toBe('commit');
    expect(overview('compare', { path: '', source: 'compare' })).toBe(
      'compare',
    );
  });
  it('places a tab by appending, replacing, or leaving pathless selections out', () => {
    const first = tab(staged, 1);
    const fresh = tab(staged, 2);
    expect(placedTab([], { opened: first, existing: undefined })).toEqual([
      first,
    ]);
    expect(placedTab([first], { opened: fresh, existing: first })).toEqual([
      fresh,
    ]);
    const pathless = tab({ path: '', source: 'commit' }, 3);
    expect(
      placedTab([first], { opened: pathless, existing: undefined }),
    ).toEqual([first]);
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
    const state = withTabs([editingTab, tab(staged, 2)]);
    const selection = repoSelection(state, repo);
    expect(editingElsewhere(selection, 'b.ts')).toBe(true);
    expect(editingElsewhere(selection, 'b.ts', editingTab)).toBe(false);
    expect(editingElsewhere(selection, 'a.ts')).toBe(false);
    expect(findTab(selection, 'working', tabKey(staged))?.used).toBe(2);
    expect(findTab(selection, 'history', tabKey(staged))).toBeUndefined();
    expect(repoSelection({ repos: {} }, 'missing')).toBe(emptyRepoSelection);
  });
  it('picks the most recently used tab', () => {
    expect(mostRecent([tab(staged, 1), tab(unstaged, 5)])?.used).toBe(5);
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
    const state = withTabs([tab(staged, 1), tab(unstaged, 2)], unstaged);
    const next = closedTab(state, {
      id: repo,
      mode: 'working',
      tab: tab(staged, 1),
    });
    expect(next.repos[repo]?.tabs.working).toEqual([tab(unstaged, 2)]);
    expect(next.repos[repo]?.current.working).toBe(unstaged);
  });
  it('moves to the most recent tab, or the overview, when the active tab closes', () => {
    const state = withTabs([tab(staged, 1), tab(unstaged, 2)], unstaged);
    const next = closedTab(state, {
      id: repo,
      mode: 'working',
      tab: tab(unstaged, 2),
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
});

describe('tab transitions', () => {
  const empty: TabsState = {
    tabs: [],
    active: '',
    recent: [],
    messages: {},
    modes: {},
  };
  it('joins members once and opens with the requested view', () => {
    const one = joined([], { id: 'p', name: 'P', member: 'p' });
    expect(one).toEqual([{ id: 'p', name: 'P', view: 'p', members: ['p'] }]);
    expect(joined(one, { id: 'p', name: 'P', member: 'p' })).toBe(one);
    const two = joined(one, { id: 'p', name: 'P', member: 'w' });
    expect(two[0].members).toEqual(['p', 'w']);
    const state = openedTab(
      { ...empty, tabs: two },
      {
        id: 'p',
        name: 'P',
        member: 'w',
      },
    );
    expect(state.active).toBe('p');
    expect(state.tabs[0].view).toBe('w');
    expect(shown(state, 'p', 'p').tabs[0].view).toBe('p');
  });
  it('moves a used tab to the front of the recency list', () => {
    expect(touched(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });
  it('leaves a member and falls back to the anchor or first member', () => {
    const state: TabsState = {
      ...empty,
      tabs: [{ id: 'p', name: 'P', view: 'w', members: ['p', 'w'] }],
      messages: { w: 'draft' },
    };
    const left = departed(state, { id: 'p', member: 'w' });
    expect(left.tabs[0]).toEqual({
      id: 'p',
      name: 'P',
      view: 'p',
      members: ['p'],
    });
    expect(left.messages).toEqual({});
    const orphan: TabsState = {
      ...empty,
      tabs: [{ id: 'p', name: 'P', view: 'p', members: ['p', 'w'] }],
    };
    expect(departed(orphan, { id: 'p', member: 'p' }).tabs[0].view).toBe('w');
    const elsewhere = departed(orphan, { id: 'p', member: 'w' });
    expect(elsewhere.tabs[0].view).toBe('p');
  });
  it('closes a tab with its drafts and activates another', () => {
    const state: TabsState = {
      tabs: [
        { id: 'a', name: 'A', view: 'a', members: ['a'] },
        { id: 'b', name: 'B', view: 'b', members: ['b'] },
      ],
      active: 'a',
      recent: ['a', 'b'],
      messages: { a: 'm' },
      modes: { a: 'commitPush' },
    };
    const next = closed(state, 'a');
    expect(next.active).toBe('b');
    expect(next.recent).toEqual(['b']);
    expect(next.messages).toEqual({});
    expect(next.modes).toEqual({});
    expect(closed(state, 'b').active).toBe('a');
    expect(closed({ ...state, tabs: [state.tabs[0]] }, 'a').active).toBe('');
  });
  it('activates and cycles through tabs', () => {
    const state: TabsState = {
      ...empty,
      tabs: [
        { id: 'a', name: 'A', view: 'a', members: ['a'] },
        { id: 'b', name: 'B', view: 'b', members: ['b'] },
      ],
      active: 'b',
    };
    expect(activated(state, 'a').recent).toEqual(['a']);
    expect(cycled(state, 1).active).toBe('a');
    expect(cycled(state, -1).active).toBe('a');
    expect(cycled(empty, 1)).toBe(empty);
  });
});

describe('activity transitions', () => {
  const activity: Activity = {
    id: 1,
    command: 'sync',
    args: {},
    visible: false,
    held: false,
    done: false,
  };
  it('starts, progresses and finishes activities per scope', () => {
    const begun = started({ scopes: {} }, { scope: 's', activity: activity });
    expect(begun.scopes.s).toEqual([activity]);
    const moving = progressed(begun, {
      scope: 's',
      progress: { phase: 'Receiving', percent: 40 },
    });
    expect(moving.scopes.s[0]).toMatchObject({
      phase: 'Receiving',
      percent: 40,
    });
    const held = edited(moving, {
      scope: 's',
      id: 1,
      patch: { visible: true, held: true, done: true },
    });
    expect(held.scopes.s).toHaveLength(1);
    expect(progressed(held, { scope: 's', progress: { phase: 'x' } })).toEqual(
      held,
    );
    const gone = edited(held, { scope: 's', id: 1, patch: { held: false } });
    expect(gone.scopes.s).toEqual([]);
  });
});

describe('layout transitions', () => {
  it('shares project-wide widths with siblings and keeps the rest per tab', () => {
    const next = updated(
      { tabs: {} },
      { id: 'a', siblings: ['a', 'b'], patch: { width: 400, filesOpen: true } },
    );
    expect(next.tabs.a).toEqual({
      ...layoutDefaults,
      width: 400,
      filesOpen: true,
    });
    expect(next.tabs.b).toEqual({ ...layoutDefaults, width: 400 });
  });
});

describe('editor transitions', () => {
  const key = { repo: repo, path: 'a.ts' };
  const opened: Opened = {
    text: 'one',
    version: 'v1',
    bom: false,
    crlf: false,
  };
  const state = EditorState.create({ doc: 'one' });
  const buffer = freshBuffer(key, opened, state);
  it('adds, patches and removes buffers', () => {
    const empty: EditorBuffers = { buffers: {} };
    const added = withBuffer(empty, key, buffer);
    expect(bufferIn(added, key)).toBe(buffer);
    expect(bufferIn(patched(added, key, { dirty: true }), key)?.dirty).toBe(
      true,
    );
    expect(patched(empty, key, { dirty: true })).toBe(empty);
    expect(bufferIn(withoutBuffer(added, key), key)).toBeUndefined();
    expect(withoutRepo(added, repo).buffers).toEqual({});
    expect(withoutBuffer(empty, key).buffers[repo]).toEqual({});
  });
  it('protects buffers with edits, saves or conflicts', () => {
    expect(isBufferProtected(undefined)).toBe(false);
    expect(isBufferProtected(buffer)).toBe(false);
    expect(isBufferProtected({ ...buffer, dirty: true })).toBe(true);
    expect(isBufferProtected({ ...buffer, saving: true })).toBe(true);
    expect(isBufferProtected({ ...buffer, conflict: { current: null } })).toBe(
      true,
    );
  });
  it('reconciles a buffer with the file on disk', () => {
    expect(reconcile(buffer, opened)).toEqual({ kind: 'unchanged' });
    const changed = { ...opened, version: 'v2', text: 'two' };
    expect(reconcile(buffer, changed)).toEqual({
      kind: 'reload',
      current: changed,
    });
    expect(reconcile({ ...buffer, dirty: true }, changed)).toEqual({
      kind: 'conflict',
      current: changed,
    });
    expect(reconcile(buffer, null)).toEqual({ kind: 'drop' });
  });
  it('applies each reconciliation to the stored buffer', () => {
    openBuffer(key, opened, state);
    applyReconciliation(key, { kind: 'unchanged' });
    expect(current(key)?.disk.version).toBe('v1');
    applyReconciliation(key, { kind: 'conflict', current: null });
    expect(current(key)?.conflict).toEqual({ current: null });
    const changed = { ...opened, version: 'v2', text: 'two' };
    applyReconciliation(key, { kind: 'reload', current: changed });
    expect(current(key)?.disk.version).toBe('v2');
    expect(current(key)?.state.doc.toString()).toBe('two');
    applyReconciliation(key, { kind: 'drop' });
    expect(current(key)).toBeUndefined();
    useEditor.setState({ buffers: {} });
  });
});

describe('generation and notice helpers', () => {
  it('reads each generation state', () => {
    expect(isGenerating(null)).toBe(false);
    expect(isGenerating({ kind: 'running' })).toBe(true);
    const applied = { kind: 'applied' as const, applied: generated };
    expect(appliedMessage(applied)).toBe(generated);
    expect(appliedMessage(null)).toBeNull();
    expect(generationError({ kind: 'failed', error: 'no' })).toBe('no');
    expect(generationError(applied)).toBeNull();
  });
  it('relabels only the latest failure of a command', () => {
    const error = { category: 'git', message: 'm' };
    const list: Failure[] = [
      { id: 1, error: error, command: 'sync' },
      { id: 2, error: error, command: 'sync' },
      { id: 3, error: error, command: 'commit' },
    ];
    const next = relabeled(list, 'sync', { title: 'Push failed' });
    expect(next.map((failure) => failure.title)).toEqual([
      undefined,
      'Push failed',
      undefined,
    ]);
  });
  it('replaces superseded notices when announcing', () => {
    const list: Notice[] = [
      { id: 1, key: 'stash', title: 'Stashed' },
      { id: 2, key: 'other', title: 'Other' },
    ];
    const next = announced(list, {
      id: 3,
      key: 'restore',
      replaces: 'stash',
      title: 'Restored',
    });
    expect(next.map((notice) => notice.id)).toEqual([2, 3]);
  });
});
