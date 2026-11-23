import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { milliseconds } from 'date-fns';
import {
  changedFiles,
  hasWorktreeChange,
  isDiscardable,
  isStagedEntry,
  steppedFile,
} from '../lib/working-files';
import { commitPlan, routeCommit } from '../lib/commit';
import { applyDarkClass, followSystemTheme, isDark } from '../lib/theme';
import {
  activeAfterRestore,
  createTeardown,
  snapshotSession,
  type RestoredTab,
} from '../lib/session';
import { isTreeInvalidation, watchTreeInvalidation } from '../lib/tree-refresh';
import { scheduleAutoFetch } from '../lib/fetch-schedule';
import { patched, useFormState } from '../lib/form-state';
import { client, queryKey } from '../lib/query';
import type { Entry, Session } from '../lib/types';
import {
  expanded,
  fullyOpened,
  toggledFull,
} from '../components/diff/openings';
import {
  highlighted,
  idleHighlight,
  noTokens,
  sameInputs,
} from '../components/diff/highlight-state';
import {
  ACTIONABLE_TOAST_DURATION_MS,
  TOAST_DURATION_MS,
  diffNotices,
  toastDuration,
  toastEntries,
} from '../components/shell/toast-notices';
import {
  emptyCursor,
  moved,
  paged,
  pointedAt,
  searched,
} from '../components/shell/palette-cursor';
import { withViewMode } from '../components/diff/view-mode';
import { clampedTo } from '../components/shell/ResizeHandle';
import type { Gap } from '../components/diff/rows';
import { appScope, type Failure } from '../stores/errors';
import type { Notice } from '../stores/successes';
import { useCommit } from '../stores/commit';
import { useSystemTheme } from '../stores/theme';
import { useTabs } from '../stores/tabs';
import { calls, mockCommand } from './harness';
import { diff, repository } from './fixtures';

afterEach(() => {
  vi.useRealTimers();
});

const staged: Entry = {
  kind: 'ordinary',
  path: 'staged.ts',
  index: 'M',
  worktree: '.',
};
const both: Entry = {
  kind: 'ordinary',
  path: 'both.ts',
  index: 'A',
  worktree: 'M',
};
const fresh: Entry = {
  kind: 'untracked',
  path: 'new.ts',
  index: '?',
  worktree: '?',
};

describe('working files', () => {
  it('lists the staged and unstaged sides of each entry under the filter', () => {
    expect(changedFiles([staged, both, fresh], '')).toEqual([
      { path: 'staged.ts', source: 'staged' },
      { path: 'both.ts', source: 'staged' },
      { path: 'both.ts', source: 'unstaged' },
      { path: 'new.ts', source: 'file' },
    ]);
    expect(changedFiles([staged, both, fresh], 'BOTH')).toHaveLength(2);
  });
  it('classifies entries for the selected-file actions', () => {
    expect(isStagedEntry(staged)).toBe(true);
    expect(isStagedEntry(fresh)).toBe(false);
    expect(hasWorktreeChange(staged)).toBe(false);
    expect(isDiscardable(both)).toBe(true);
    expect(isDiscardable(fresh)).toBe(false);
  });
  it('steps through the files and wraps around', () => {
    const files = changedFiles([staged, both], '');
    expect(
      steppedFile({ files: files, current: undefined, direction: 1 }),
    ).toEqual(files[0]);
    expect(
      steppedFile({
        files: files,
        current: { path: 'staged.ts', source: 'staged' },
        direction: -1,
      }),
    ).toEqual(files[2]);
    expect(
      steppedFile({ files: [], current: undefined, direction: 1 }),
    ).toBeUndefined();
  });
});

describe('commit routing', () => {
  it('plans whether a commit can run and what it stages', () => {
    const plan = commitPlan({
      entries: [both, fresh],
      hasMessage: true,
      smartCommit: 'never',
    });
    expect(plan).toEqual({
      staged: true,
      changes: ['both.ts', 'new.ts'],
      committable: true,
      smartCommit: 'never',
    });
    expect(
      commitPlan({ entries: [fresh], hasMessage: true, smartCommit: 'never' })
        .committable,
    ).toBe(false);
    expect(
      commitPlan({ entries: [fresh], hasMessage: true, smartCommit: 'ask' })
        .committable,
    ).toBe(true);
    expect(
      commitPlan({ entries: [both], hasMessage: false, smartCommit: 'ask' })
        .committable,
    ).toBe(false);
  });
  it('commits staged work, stages everything when smart, or asks first', async () => {
    mockCommand('files_action', () => null);
    mockCommand('commit', () => 'abc1234');
    useTabs.getState().setMessage('r', 'message');
    const plan = commitPlan({
      entries: [fresh],
      hasMessage: true,
      smartCommit: 'ask',
    });
    routeCommit({ repo: 'r', mode: 'commit', plan: plan });
    expect(useCommit.getState().repos.r?.prompt).toBe('commit');
    await routeCommit({
      repo: 'r',
      mode: 'commit',
      plan: { ...plan, smartCommit: 'always' },
    });
    expect(calls.map((call) => call.command)).toEqual([
      'files_action',
      'commit',
    ]);
    calls.length = 0;
    useTabs.getState().setMessage('r', 'again');
    await routeCommit({
      repo: 'r',
      mode: 'commit',
      plan: { ...plan, staged: true },
    });
    expect(calls.map((call) => call.command)).toEqual(['commit']);
  });
});

describe('theme', () => {
  it('derives dark mode from the preference and the system', () => {
    expect(isDark('dark', false)).toBe(true);
    expect(isDark('light', true)).toBe(false);
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
  });
  it('follows the system scheme until stopped and toggles the root class', () => {
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => media);
    const stop = followSystemTheme();
    expect(useSystemTheme.getState().dark).toBe(true);
    const report = media.addEventListener.mock.calls[0][1];
    media.matches = false;
    report();
    expect(useSystemTheme.getState().dark).toBe(false);
    stop();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', report);
    applyDarkClass(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyDarkClass(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('session helpers', () => {
  it('runs every teardown once, and immediately once stopped', () => {
    const teardown = createTeardown();
    const first = vi.fn();
    teardown.add(first);
    expect(teardown.stopped).toBe(false);
    teardown.stop();
    expect(first).toHaveBeenCalledTimes(1);
    expect(teardown.stopped).toBe(true);
    const late = vi.fn();
    teardown.add(late);
    expect(late).toHaveBeenCalledTimes(1);
    teardown.stop();
    expect(first).toHaveBeenCalledTimes(1);
  });
  it('picks the restored active project, or the latest one', () => {
    const session: Session = {
      tabs: [
        { path: '/a', message: '' },
        { path: '/b', message: '' },
      ],
      active: '/a',
    };
    const restored = (path: string, project: string): RestoredTab => ({
      tab: { path: path, message: '' },
      repo: { ...repository, id: path, project: project },
    });
    expect(activeAfterRestore(session, [])).toBeUndefined();
    useTabs.getState().open('/pa', 'A');
    useTabs.getState().open('/pb', 'B');
    expect(
      activeAfterRestore(session, [
        restored('/a', '/pa'),
        restored('/b', '/pb'),
      ]),
    ).toBe('/pa');
    expect(activeAfterRestore(session, [restored('/b', '/pb')])).toBe('/pb');
  });
  it('snapshots every member with its draft and visibility', () => {
    useTabs.getState().open('/p', 'P');
    useTabs.getState().join('/p', 'P', '/w');
    useTabs.getState().setMessage('/w', 'draft');
    const snapshot = snapshotSession();
    expect(snapshot.active).toBe('/p');
    expect(
      snapshot.tabs.map((tab) => [tab.path, tab.message, tab.shown]),
    ).toEqual([
      ['/p', '', true],
      ['/w', 'draft', false],
    ]);
  });
});

describe('tree refresh', () => {
  it('relists once per batch of tree invalidations for its repository', async () => {
    const relist = vi.fn();
    const key = queryKey('tree', { repo: 'r', path: '' });
    client.setQueryData(key, []);
    const stop = watchTreeInvalidation('r', relist);
    await client.invalidateQueries({ queryKey: key, refetchType: 'none' });
    await client.invalidateQueries({ queryKey: key, refetchType: 'none' });
    await Promise.resolve();
    expect(relist).toHaveBeenCalledTimes(1);
    stop();
    const again = vi.fn();
    const stopAgain = watchTreeInvalidation('r', again);
    await Promise.resolve();
    expect(again).toHaveBeenCalledTimes(1);
    stopAgain();
    client.clear();
  });
  it('ignores events that are not a tree invalidation of the repository', () => {
    const query = client.getQueryCache().build(client, {
      queryKey: queryKey('status', { repo: 'r' }),
    });
    expect(isTreeInvalidation({ type: 'added', query: query }, 'r')).toBe(
      false,
    );
    expect(
      isTreeInvalidation(
        { type: 'updated', query: query, action: { type: 'invalidate' } },
        'r',
      ),
    ).toBe(false);
    expect(
      isTreeInvalidation(
        { type: 'updated', query: query, action: { type: 'fetch' } },
        'r',
      ),
    ).toBe(false);
    client.clear();
  });
});

describe('auto fetch', () => {
  it('fetches each shown view on the interval without overlapping', async () => {
    vi.useFakeTimers();
    let finish = () => {};
    mockCommand(
      'sync',
      () =>
        new Promise<null>((resolve) => {
          finish = () => resolve(null);
        }),
    );
    useTabs.getState().open('/a', 'A');
    expect(scheduleAutoFetch(null)).toBeUndefined();
    const stop = scheduleAutoFetch({ seconds: 30 });
    vi.advanceTimersByTime(milliseconds({ seconds: 30 }));
    vi.advanceTimersByTime(milliseconds({ seconds: 30 }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    finish();
    await vi.advanceTimersByTimeAsync(milliseconds({ seconds: 30 }));
    expect(calls).toHaveLength(2);
    stop?.();
  });
});

describe('form state', () => {
  it('patches and resets a grouped form', () => {
    expect(patched({ name: 'a', open: false }, { open: true })).toEqual({
      name: 'a',
      open: true,
    });
    const initial = { name: '', open: false };
    const { result } = renderHook(() => useFormState(initial));
    act(() => result.current.update({ name: 'feature' }));
    expect(result.current.form).toEqual({ name: 'feature', open: false });
    act(() => result.current.reset());
    expect(result.current.form).toBe(initial);
  });
});

describe('diff view state', () => {
  const gap: Gap = {
    key: 'g',
    kind: 'mid',
    start: 1,
    end: 40,
    offset: 0,
    hunk: 0,
  };
  it('widens a gap in each direction and toggles the full file', () => {
    expect(expanded({}, { gap: gap, direction: 'down' })).toEqual({
      g: { down: 20, up: 0 },
    });
    expect(
      expanded({ g: { down: 20, up: 0 } }, { gap: gap, direction: 'up' }),
    ).toEqual({ g: { down: 20, up: 20 } });
    expect(
      expanded({ g: { down: 20, up: 0 } }, { gap: gap, direction: 'all' }),
    ).toEqual({ g: { down: 20, up: Infinity } });
    expect(fullyOpened([gap])).toEqual({ g: { down: 0, up: Infinity } });
    expect(toggledFull([gap], true)).toEqual({});
    expect(toggledFull([gap], false)).toEqual(fullyOpened([gap]));
  });
  it('compares highlight inputs field by field', () => {
    const inputs = { data: diff, path: 'a', dark: false };
    expect(sameInputs(inputs, { ...inputs })).toBe(true);
    expect(sameInputs(inputs, { ...inputs, dark: true })).toBe(false);
    expect(idleHighlight('a', true)).toEqual({
      inputs: { path: 'a', dark: true },
      done: false,
      tokens: noTokens,
    });
    expect(highlighted(inputs, noTokens, true).done).toBe(true);
  });
  it('switches one view mode on and the others off', () => {
    const selection = { path: 'a.md', source: 'unstaged' as const };
    expect(
      withViewMode({ ...selection, blame: true }, 'rendered', true),
    ).toEqual({
      ...selection,
      rendered: true,
      blame: false,
      editing: false,
    });
  });
  it('clamps a resize value into its bounds', () => {
    const bounds = { min: 10, max: 20, step: 1 };
    expect(clampedTo(bounds, 5)).toBe(10);
    expect(clampedTo(bounds, 25)).toBe(20);
    expect(clampedTo(bounds, 15)).toBe(15);
  });
});

describe('toast notices', () => {
  const failure: Failure = {
    id: 1,
    error: { category: 'git', message: 'boom' },
  };
  const notice: Notice = { id: 2, key: 'done', title: 'Done' };
  it('orders app failures, tab failures and notices by id', () => {
    const entries = toastEntries({
      active: '/r',
      app: [{ ...failure, id: 3 }],
      tab: [failure],
      done: [notice],
    });
    expect(entries.map((entry) => [entry.scope, entry.id])).toEqual([
      ['/r', 1],
      ['/r', 2],
      [appScope, 3],
    ]);
  });
  it('reports which toasts to dismiss and which to publish', () => {
    const entries = toastEntries({
      active: '/r',
      app: [],
      tab: [failure],
      done: [notice],
    });
    const changes = diffNotices([1, 9], entries);
    expect(changes.removed).toEqual([9]);
    expect(changes.added.map((entry) => entry.id)).toEqual([2]);
  });
  it('keeps failures and pending notices until dismissed', () => {
    const scope = '/r';
    expect(toastDuration({ scope: scope, id: 1, failure: failure })).toBe(
      Infinity,
    );
    expect(
      toastDuration({
        scope: scope,
        id: 2,
        notice: { ...notice, pending: true },
      }),
    ).toBe(Infinity);
    expect(
      toastDuration({ scope: scope, id: 2, notice: { ...notice, show: '/w' } }),
    ).toBe(ACTIONABLE_TOAST_DURATION_MS);
    expect(toastDuration({ scope: scope, id: 2, notice: notice })).toBe(
      TOAST_DURATION_MS,
    );
  });
});

describe('palette cursor', () => {
  it('resets on search and moves, pages and points within the rows', () => {
    expect(searched('ab')).toEqual({ filter: 'ab', index: 0 });
    const cursor = { filter: 'a', index: 9 };
    expect(moved(cursor, { delta: 1, count: 3 }).index).toBe(0);
    expect(moved(cursor, { delta: -1, count: 3 }).index).toBe(1);
    expect(moved(cursor, { delta: 1, count: 0 }).index).toBe(0);
    expect(paged(emptyCursor, { delta: 10, count: 4 }).index).toBe(3);
    expect(paged(cursor, { delta: -10, count: 4 }).index).toBe(0);
    expect(pointedAt(cursor, 2)).toEqual({ filter: 'a', index: 2 });
  });
});
