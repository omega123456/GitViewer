import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { format, milliseconds, parseISO, subMinutes } from 'date-fns';
import { undo } from '@codemirror/commands';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { client } from '../lib/query';
import type { Status } from '../lib/types';
import {
  callsFor,
  clearCalls,
  emit,
  lastError,
  mockCommand,
  pendingActivity,
} from './harness';
import { HASH_LENGTH, repository, settings, status } from './fixtures';
import {
  commit,
  count,
  findEditorView,
  mountApp,
  repoCalls,
  runAction,
  setup,
  waitForQueriesIdle,
} from './workbench';

const THREE_REFRESHES = 3;
const THIRTY_SECONDS = 30;
const TWO_TABS = 2;
const FOUR_SYNCS = 4;
const TWO_MINUTES_AGO = 2;
const TEN_MINUTES = 10;
const EDITOR_SCROLL_TOP = 120;
const HISTORY_PAGE_SIZE = 100;
const LAST_PAGE_INDEX = 2;

function historyPage(index: number) {
  return {
    commits: Array.from({ length: HISTORY_PAGE_SIZE }, (_unused, offset) => ({
      ...commit,
      hash: `${index}-${offset}`.padEnd(HASH_LENGTH, '0'),
      subject: `commit ${index}-${offset}`,
    })),
    cursor: index < LAST_PAGE_INDEX ? `cursor-${index + 1}` : null,
  };
}

it('refreshes only the active tab on focus, untracked, and reports to its scope', async () => {
  setup();
  useTabs.getState().open('/second', 'Second');
  useTabs.getState().activate(repository.id);
  mountApp();
  await screen.findAllByLabelText('Commit message');
  await waitForQueriesIdle();
  expect(count('refresh')).toBe(0);
  fireEvent.focus(window);
  expect(pendingActivity()).toEqual([]);
  await waitFor(() => expect(count('refresh')).toBe(1));
  expect(callsFor('refresh')[0]).toEqual({ repo: repository.id });
  await runAction('next-tab', repository.id);
  expect(useTabs.getState().active).toBe('/second');
  act(() => useTabs.getState().open('/third', 'Third'));
  await waitForQueriesIdle();
  expect(count('refresh')).toBe(1);
  mockCommand('refresh', () => {
    throw new Error('Status failed');
  });
  fireEvent.focus(window);
  await waitFor(() =>
    expect(lastError('/third')?.message).toBe('Status failed'),
  );
  expect(lastError(repository.id)).toBeUndefined();
  expect(callsFor('refresh').at(-1)).toEqual({ repo: '/third' });
  mockCommand('refresh', () => null);
  fireEvent.focus(window);
  await waitFor(() => expect(lastError('/third')).toBeUndefined());
  expect(count('refresh')).toBe(THREE_REFRESHES);
  act(() => useTabs.getState().activate(''));
  fireEvent.focus(window);
  await waitForQueriesIdle();
  expect(count('refresh')).toBe(THREE_REFRESHES);
});

it('auto fetches every open tab on its interval, untracked, silent and never overlapping', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setup();
  useTabs.getState().open('/second', 'Second');
  useTabs.getState().activate(repository.id);
  mockCommand('settings_get', () => ({
    ...settings,
    autoFetchInterval: '30s',
  }));
  const pending: (() => void)[] = [];
  mockCommand(
    'sync',
    () => new Promise<null>((resolve) => pending.push(() => resolve(null))),
  );
  mountApp();
  await screen.findAllByLabelText('Commit message');
  expect(count('sync')).toBe(0);
  act(() => vi.advanceTimersByTime(milliseconds({ seconds: THIRTY_SECONDS })));
  await waitFor(() => expect(count('sync')).toBe(TWO_TABS));
  expect(callsFor('sync')).toEqual([
    { repo: repository.id, action: 'fetch' },
    { repo: '/second', action: 'fetch' },
  ]);
  expect(pendingActivity()).toEqual([]);
  act(() => vi.advanceTimersByTime(milliseconds({ seconds: THIRTY_SECONDS })));
  expect(count('sync')).toBe(TWO_TABS);
  mockCommand('sync', () => {
    throw new Error('Offline');
  });
  await act(async () => pending.forEach((finish) => finish()));
  act(() => vi.advanceTimersByTime(milliseconds({ seconds: THIRTY_SECONDS })));
  await waitFor(() => expect(count('sync')).toBe(FOUR_SYNCS));
  await waitForQueriesIdle();
  expect(lastError(repository.id)).toBeUndefined();
  expect(lastError('/second')).toBeUndefined();
});

it('shows when the view was last fetched and keeps the relative time current', async () => {
  const now = parseISO('2026-10-23T12:00:00Z');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(now);
  setup();
  let current: Status = status;
  mockCommand('status', () => current);
  mountApp();
  expect(await screen.findByText('Not fetched yet')).toBeVisible();
  current = {
    ...status,
    fetched: subMinutes(now, TWO_MINUTES_AGO).toISOString(),
  };
  act(() => emit('repo://status-changed', { repo: repository.id }));
  const label = await screen.findByText('Fetched 2 minutes ago');
  expect(label).toHaveAttribute(
    'title',
    `Fetched ${format(subMinutes(now, TWO_MINUTES_AGO), 'd MMMM yyyy, HH:mm O')}`,
  );
  act(() => vi.advanceTimersByTime(milliseconds({ minutes: 1 })));
  expect(await screen.findByText('Fetched 3 minutes ago')).toBeVisible();
  current = { ...status, upstream: null, fetched: null };
  act(() => emit('repo://status-changed', { repo: repository.id }));
  await waitFor(() =>
    expect(screen.queryByText(/fetched/i)).not.toBeInTheDocument(),
  );
});

it('keeps a hidden tab to its badge status and catches up when shown', async () => {
  setup();
  useTabs.getState().open('/second', 'Second');
  useSelection
    .getState()
    .select('/second', { path: 'src/app.ts', source: 'unstaged' });
  mountApp();
  await waitFor(() => expect(repoCalls('/second')).toContain('diff'));
  await runAction('previous-tab', '/second');
  expect(useTabs.getState().active).toBe(repository.id);
  await waitForQueriesIdle();
  clearCalls();
  act(() => emit('repo://status-changed', { repo: '/second' }));
  await waitFor(() => expect(repoCalls('/second')).toEqual(['status']));
  await waitForQueriesIdle();
  expect(repoCalls('/second')).toEqual(['status']);
  expect(repoCalls(repository.id)).toEqual([]);
  act(() => useTabs.getState().activate('/second'));
  await waitFor(() => expect(repoCalls('/second')).toContain('diff'));
});

it('re-lists the expanded folders of a hidden Files tree when its tab is shown', async () => {
  setup();
  let listed = ['app.ts'];
  mockCommand('tree', ({ path }) =>
    path
      ? listed.map((name) => ({
          path: `src/${name}`,
          name: name,
          directory: false,
          ignored: false,
          status: '',
        }))
      : [
          {
            path: 'src',
            name: 'src',
            directory: true,
            ignored: false,
            status: '',
          },
        ],
  );
  useTabs.getState().open('/second', 'Second');
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByRole('button', { name: /^Files/ }));
  const files = await screen.findByRole('tree', { name: 'All files' });
  await user.click(await within(files).findByRole('treeitem', { name: 'src' }));
  await within(files).findByRole('treeitem', { name: 'app.ts' });
  for (const [event, name] of [
    ['repo://files-changed', 'first.ts'],
    ['repo://status-changed', 'second.ts'],
  ] as const) {
    await runAction('previous-tab', '/second');
    listed = [...listed, name];
    clearCalls();
    act(() => emit(event, { repo: '/second' }));
    await waitForQueriesIdle();
    expect(repoCalls('/second')).not.toContain('tree');
    act(() => useTabs.getState().activate('/second'));
    expect(await within(files).findByRole('treeitem', { name })).toBeVisible();
    expect(callsFor('tree').filter((args) => args.path === 'src')).toHaveLength(
      1,
    );
  }
});

it('re-lists the Files tree on a status change long after it first loaded', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setup();
  let listed = ['app.ts'];
  mockCommand('tree', () =>
    listed.map((name) => ({
      path: name,
      name: name,
      directory: false,
      ignored: false,
      status: '',
    })),
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  mountApp();
  await user.click(await screen.findByRole('button', { name: /^Files/ }));
  const files = await screen.findByRole('tree', { name: 'All files' });
  await within(files).findByRole('treeitem', { name: 'app.ts' });
  act(() => vi.advanceTimersByTime(milliseconds({ minutes: TEN_MINUTES })));
  listed = [...listed, 'later.ts'];
  act(() => emit('repo://status-changed', { repo: repository.id }));
  expect(
    await within(files).findByRole('treeitem', { name: 'later.ts' }),
  ).toBeVisible();
});

it('returns to a hidden editor with its text, history, scroll and focus', async () => {
  setup();
  mockCommand('file_read', () => ({
    text: 'a\nb\nc\n',
    version: 'v1',
    bom: false,
    crlf: false,
  }));
  mockCommand('file_lines', () => 'a\nb\nc\n');
  mockCommand('unsaved_set', () => null);
  useTabs.getState().open('/second', 'Second');
  useTabs.getState().activate(repository.id);
  useSelection
    .getState()
    .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  const before = await findEditorView();
  act(() => before.dispatch({ changes: { from: 0, insert: 'typed ' } }));
  before.scrollDOM.scrollTop = EDITOR_SCROLL_TOP;
  act(() => before.focus());
  expect(before.hasFocus).toBe(true);
  await runAction('next-tab', repository.id);
  expect(useTabs.getState().active).toBe('/second');
  await runAction('previous-tab', '/second');
  const after = await findEditorView();
  expect(after).not.toBe(before);
  expect(after.state.doc.toString()).toBe('typed a\nb\nc\n');
  await waitFor(() =>
    expect(after.scrollDOM.scrollTop).toBe(EDITOR_SCROLL_TOP),
  );
  expect(after.hasFocus).toBe(true);
  act(() => {
    undo(after);
  });
  expect(after.state.doc.toString()).toBe('a\nb\nc\n');
});

it('trims loaded history to its first page on a head change and keeps it on screen', async () => {
  setup();
  client.setQueryData([repository.id, 'history', ''], {
    pages: [historyPage(0), historyPage(1), historyPage(LAST_PAGE_INDEX)],
    pageParams: ['', 'cursor-1', 'cursor-2'],
  });
  let release = () => {};
  mockCommand(
    'history',
    () =>
      new Promise((resolve) => {
        release = () => resolve(historyPage(0));
      }),
  );
  useLayout.getState().update(repository.id, { mode: 'history' });
  mountApp();
  expect(await screen.findByText('300')).toBeVisible();
  expect(await screen.findByText('commit 0-0')).toBeVisible();
  expect(count('history')).toBe(0);
  act(() => emit('repo://head-changed', { repo: repository.id }));
  expect(screen.getByText('commit 0-0')).toBeVisible();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  await waitFor(() => expect(count('history')).toBe(1));
  expect(callsFor('history')[0]).toEqual({
    repo: repository.id,
    path: '',
    cursor: '',
  });
  expect(screen.getByText('100')).toBeVisible();
  expect(screen.getByText('commit 0-0')).toBeVisible();
  await act(async () => release());
  await waitForQueriesIdle();
  expect(screen.getByText('100')).toBeVisible();
  expect(count('history')).toBe(1);
});
