import { expect, it } from 'vitest';
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
import {
  appliedMessage,
  generationError,
  isGenerating,
} from '../stores/generate';
import { relabeled, type Failure } from '../stores/errors';
import { announced, type Notice } from '../stores/successes';
import { generated } from './fixtures';

const PROGRESS_PERCENT = 40;
const SECOND_ID = 2;
const THIRD_ID = 3;

const emptyTabs: TabsState = {
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
    { ...emptyTabs, tabs: two },
    { id: 'p', name: 'P', member: 'w' },
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
    ...emptyTabs,
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
    ...emptyTabs,
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
    ...emptyTabs,
    tabs: [
      { id: 'a', name: 'A', view: 'a', members: ['a'] },
      { id: 'b', name: 'B', view: 'b', members: ['b'] },
    ],
    active: 'b',
  };
  expect(activated(state, 'a').recent).toEqual(['a']);
  expect(cycled(state, 1).active).toBe('a');
  expect(cycled(state, -1).active).toBe('a');
  expect(cycled(emptyTabs, 1)).toBe(emptyTabs);
});

it('starts, progresses and finishes activities per scope', () => {
  const activity: Activity = {
    id: 1,
    command: 'sync',
    args: {},
    visible: false,
    held: false,
    done: false,
  };
  const begun = started({ scopes: {} }, { scope: 's', activity: activity });
  expect(begun.scopes.s).toEqual([activity]);
  const moving = progressed(begun, {
    scope: 's',
    progress: { phase: 'Receiving', percent: PROGRESS_PERCENT },
  });
  expect(moving.scopes.s[0]).toMatchObject({
    phase: 'Receiving',
    percent: PROGRESS_PERCENT,
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
    { id: SECOND_ID, error: error, command: 'sync' },
    { id: THIRD_ID, error: error, command: 'commit' },
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
    { id: SECOND_ID, key: 'other', title: 'Other' },
  ];
  const next = announced(list, {
    id: THIRD_ID,
    key: 'restore',
    replaces: 'stash',
    title: 'Restored',
  });
  expect(next.map((notice) => notice.id)).toEqual([SECOND_ID, THIRD_ID]);
});
