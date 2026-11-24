import { describe, expect, it, vi } from 'vitest';
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
import { client, queryKey } from '../lib/query';
import type { Entry, Session } from '../lib/types';
import { useCommit } from '../stores/commit';
import { useSystemTheme } from '../stores/theme';
import { useTabs } from '../stores/tabs';
import { calls, clearCalls, mockCommand } from './harness';
import { repository } from './fixtures';

const BOTH_MATCHES = 2;

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
    expect(changedFiles([staged, both, fresh], 'BOTH')).toHaveLength(
      BOTH_MATCHES,
    );
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
    clearCalls();
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
