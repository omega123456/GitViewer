import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { milliseconds } from 'date-fns';
import { expect, it, vi } from 'vitest';
import { QueryProvider } from '../providers/QueryProvider';
import { allChangesOf } from '../stores/selection';
import { useImageViews } from '../stores/image-view';
import { DiffPane } from '../components/diff/DiffPane';
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { client } from '../lib/query';
import type { CommitFiles, Diff, DiffStack } from '../lib/types';
import { calls, emit, mockCommand } from './harness';
import { intersect, intersecting, release, workers } from './setup';
import { diff, repository, settings, stack, status } from './fixtures';
import {
  assertElement,
  blockOf,
  colored,
  commit,
  count,
  height,
  mountApp,
  picture,
  renderFile,
  renderStack,
  restart,
  scrollerOf,
  setup,
  shown,
} from './workbench';

const SAVED_SCROLL_TOP = 480;
const TWO_FILES = 2;
const DEFAULT_CONTEXT = 3;
const UPDATED_DIFF_SIZE = 16;
const IMAGE_WIDTH = 40;
const IMAGE_HEIGHT = 30;
const SETTLE_SECONDS = 0.25;

async function advanceSettle() {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds({ seconds: SETTLE_SECONDS }));
  });
}

it('shows a loading state until the commit file list arrives', async () => {
  setup();
  let releaseFiles: (files: CommitFiles) => void = () => {};
  mockCommand(
    'commit_files',
    () => new Promise<CommitFiles>((resolve) => (releaseFiles = resolve)),
  );
  render(
    <QueryProvider>
      <AllChangesPane
        repo={repository.id}
        stack="commit"
        commit={{ path: '', source: 'commit', revision: commit.hash }}
        status={status}
        settings={settings}
        disabled={false}
      />
    </QueryProvider>,
  );
  const pane = await screen.findByRole('region', {
    name: 'All changes in commit',
  });
  expect(within(pane).getByText('Loading changes')).toBeInTheDocument();
  expect(within(pane).queryByText('Nothing here')).not.toBeInTheDocument();
  await act(async () =>
    releaseFiles({ statuses: { 'src/app.ts': 'A' }, lines: {} }),
  );
  await within(pane).findByRole('button', { name: /app\.ts/ });
  expect(within(pane).queryByText('Loading changes')).not.toBeInTheDocument();
});

it('keeps the scroll position when the stack response arrives after the user scrolled', async () => {
  setup();
  let releaseStack: (value: DiffStack) => void = () => {};
  mockCommand(
    'diff_stack',
    () => new Promise<DiffStack>((resolve) => (releaseStack = resolve)),
  );
  const pane = await renderStack();
  await waitFor(() => expect(count('diff_stack')).toBe(1));
  const scroller = scrollerOf(pane);
  scroller.scrollTop = SAVED_SCROLL_TOP;
  const scrollTo = vi.mocked(scroller.scrollTo);
  scrollTo.mockClear();
  await act(async () => releaseStack(stack));
  await waitFor(() => expect(scrollTo).toHaveBeenCalled());
  expect(scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({ top: SAVED_SCROLL_TOP }),
  );
  expect(scrollTo).not.toHaveBeenCalledWith(
    expect.objectContaining({ top: 0 }),
  );
});

it('reads a whole commit stack in one request', async () => {
  setup();
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M', 'new.txt': 'A' },
    lines: {},
  }));
  const pane = await renderStack();
  await waitFor(() => expect(shown(pane, 'new value')).toBe(TWO_FILES));
  expect(calls).toContainEqual({
    command: 'diff_stack',
    args: { repo: repository.id, source: 'commit', revision: commit.hash },
  });
  expect(count('diff_stack')).toBe(1);
  expect(count('diff')).toBe(0);
});

async function verifyFallbackForTruncated(truncated: boolean) {
  setup();
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M', 'lib.ts': 'M' },
    lines: {},
  }));
  mockCommand('diff_stack', () => ({
    files: { 'src/app.ts': diff },
    truncated: truncated,
  }));
  const first = await renderStack();
  await waitFor(() => expect(count('diff')).toBe(1));
  expect(calls).toContainEqual({
    command: 'diff',
    args: {
      repo: repository.id,
      path: 'lib.ts',
      source: 'commit',
      revision: commit.hash,
      context: DEFAULT_CONTEXT,
    },
  });
  first.unmount();
  restart();
  intersecting.initially = false;
  const pane = await renderStack();
  await waitFor(() => expect(count('diff_stack')).toBe(1));
  const block = blockOf(pane, /lib\.ts/);
  await advanceSettle();
  expect(count('diff')).toBe(0);
  act(() => intersect(block, true));
  expect(count('diff')).toBe(0);
  await advanceSettle();
  await waitFor(() => expect(count('diff')).toBe(1));
  act(() => intersect(block, false));
  await advanceSettle();
  act(() => emit('repo://head-changed', { repo: repository.id }));
  await waitFor(() => expect(count('diff_stack')).toBe(TWO_FILES));
  expect(count('diff')).toBe(1);
  pane.unmount();
  restart();
  intersecting.initially = true;
}

it('falls back to a per-file read for a settled missing entry near the viewport', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await verifyFallbackForTruncated(true);
  await verifyFallbackForTruncated(false);
  setup();
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M', 'lib.ts': 'M' },
    lines: {},
  }));
  let fail: (error: Error) => void = () => {};
  mockCommand(
    'diff_stack',
    () => new Promise<DiffStack>((_resolve, reject) => (fail = reject)),
  );
  const pane = await renderStack();
  await waitFor(() => expect(count('diff_stack')).toBe(1));
  await advanceSettle();
  expect(count('diff')).toBe(0);
  expect(within(pane).getAllByText('Loading…')).toHaveLength(TWO_FILES);
  await act(async () => fail(new Error('The stack failed')));
  expect(await within(pane).findAllByText('The stack failed')).toHaveLength(
    TWO_FILES,
  );
  expect(count('diff')).toBe(0);
});

it('reserves the estimated height until a surface nears the viewport, keeps it mounted after, and sizes images at once', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setup();
  intersecting.initially = false;
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M', 'photo.png': 'M' },
    lines: {},
  }));
  mockCommand('diff_stack', () => ({
    files: {
      'src/app.ts': diff,
      'photo.png': {
        ...picture,
        newDimensions: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
      },
    },
    truncated: false,
  }));
  const pane = await renderStack();
  await waitFor(() => expect(count('diff_stack')).toBe(1));
  const block = blockOf(pane, /app\.ts/);
  const image = blockOf(pane, /photo\.png/);
  await waitFor(() =>
    expect(within(block).getByText('Loading…')).toHaveClass('h-virtual'),
  );
  expect(height(block)).toBe('64px');
  expect(within(image).queryByText('Loading…')).toBeNull();
  expect(within(image).getByAltText('After')).toHaveAttribute('width', '40');
  expect(within(image).getByAltText('After')).toHaveAttribute('height', '30');
  expect(shown(pane, 'new value')).toBe(0);
  act(() => intersect(block, true));
  await advanceSettle();
  expect(shown(block, 'new value')).toBe(1);
  act(() => intersect(block, false));
  await advanceSettle();
  expect(shown(block, 'new value')).toBe(1);
});

it('highlights a stacked file only near the viewport and drops stale tokens', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setup();
  intersecting.initially = false;
  const changed = {
    ...diff,
    hunks: [
      {
        ...diff.hunks[0],
        lines: diff.hunks[0].lines.map((line) => ({
          ...line,
          content: `${line.content};`,
        })),
      },
    ],
  };
  let current: Diff = diff;
  mockCommand('diff_stack', () => ({
    files: { 'src/app.ts': current },
    truncated: false,
  }));
  const pane = await renderStack();
  await waitFor(() => expect(count('diff_stack')).toBe(1));
  const block = blockOf(pane, /app\.ts/);
  await advanceSettle();
  expect(workers.jobs).toHaveLength(0);
  act(() => intersect(block, true));
  await advanceSettle();
  await waitFor(() => expect(colored(block)).toBeGreaterThan(0));
  const highlighted = workers.jobs.length;
  act(() => intersect(block, false));
  await advanceSettle();
  expect(colored(block)).toBeGreaterThan(0);
  current = changed;
  act(() => emit('repo://head-changed', { repo: repository.id }));
  await waitFor(() => expect(shown(block, 'new value;')).toBe(1));
  expect(colored(block)).toBe(0);
  expect(workers.jobs).toHaveLength(highlighted);
});

it('keeps the previous tokens of the file pane until new ones arrive', async () => {
  setup();
  render(
    <QueryProvider>
      <DiffPane
        repo={repository.id}
        selection={{ path: 'src/app.ts', source: 'unstaged' }}
        settings={settings}
        disabled={false}
      />
    </QueryProvider>,
  );
  const pane = await screen.findByRole('region', { name: 'Diff viewer' });
  await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
  const before = workers.jobs.length;
  workers.held = true;
  mockCommand('diff', () => ({ ...diff, newSize: UPDATED_DIFF_SIZE }));
  act(() => emit('repo://status-changed', { repo: repository.id }));
  await waitFor(() => expect(count('diff')).toBe(TWO_FILES));
  await waitFor(() => expect(workers.jobs.length).toBeGreaterThan(before));
  await waitFor(() => expect(workers.queued.length).toBeGreaterThan(0));
  expect(shown(pane, 'new value')).toBe(1);
  expect(colored(pane)).toBeGreaterThan(0);
  workers.held = false;
  await act(async () => release());
  await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
});

it('seeds a commit file from its loaded stack and fetches working-tree files', async () => {
  setup();
  const loaded = await renderStack();
  await waitFor(() => expect(shown(loaded, 'new value')).toBe(1));
  loaded.unmount();
  const selected = renderFile({
    path: 'src/app.ts',
    source: 'commit',
    revision: commit.hash,
  });
  const pane = await screen.findByRole('region', { name: 'Diff viewer' });
  expect(shown(pane, 'new value')).toBe(1);
  expect(count('diff')).toBe(0);
  selected.unmount();
  const working = await renderStack('unstaged');
  await waitFor(() => expect(count('diff_stack')).toBe(TWO_FILES));
  working.unmount();
  renderFile({ path: 'src/app.ts', source: 'unstaged' }).unmount();
  await waitFor(() => expect(count('diff')).toBe(1));
  act(() => {
    void client.invalidateQueries({
      queryKey: [repository.id, 'diff_stack'],
    });
  });
  renderFile({ path: 'new.txt', source: 'commit', revision: commit.hash });
  await waitFor(() => expect(count('diff')).toBe(TWO_FILES));
});

function setupMixedWorkingStack() {
  setup();
  mockCommand('diff_stack', () => ({
    files: {
      'src/app.ts': diff,
      'new.txt': { ...picture, path: 'new.txt' },
    },
    truncated: false,
  }));
  mockCommand('hunk_action', () => null);
  mockCommand('system_open', () => null);
}

it('stacks every file of a group, collapses files, and returns on selection', async () => {
  setupMixedWorkingStack();
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByRole('button', { name: 'All changes' }));
  const pane = await screen.findByRole('region', { name: 'All changes' });
  await user.click(
    within(
      await within(pane).findByLabelText('Image comparison mode'),
    ).getByRole('tab', { name: 'swipe' }),
  );
  expect(useImageViews.getState().tabs[`${repository.id}:new.txt`].mode).toBe(
    'swipe',
  );
  expect(useImageViews.getState().tabs[repository.id]).toBeUndefined();
  act(() => useImageViews.getState().forget(repository.id));
  expect(
    useImageViews.getState().tabs[`${repository.id}:new.txt`],
  ).toBeUndefined();
  await user.click(await within(pane).findByTitle('Stage hunk'));
  expect(calls).toContainEqual({
    command: 'hunk_action',
    args: {
      repo: repository.id,
      path: 'src/app.ts',
      source: 'unstaged',
      hunk: 0,
      patch: 'patch',
      action: 'stage',
    },
  });
  const header = assertElement(
    within(pane).getByRole('button', { name: /app\.ts/ }).parentElement,
  );
  await user.click(within(header).getByLabelText('Copy file path'));
  expect(calls).toContainEqual({
    command: 'clipboard_write',
    args: { text: 'src/app.ts' },
  });
  await user.click(within(header).getByRole('button', { name: 'Open' }));
  expect(calls).toContainEqual({
    command: 'system_open',
    args: { repo: repository.id, path: 'src/app.ts' },
  });
  await user.click(within(pane).getByRole('button', { name: /app\.ts/ }));
  expect(within(pane).queryByTitle('Stage hunk')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'All staged changes' }));
  await screen.findByRole('region', { name: 'All staged changes' });
  await user.click(
    within(screen.getByRole('tree', { name: 'Changes' })).getByRole(
      'treeitem',
      { name: 'app.ts' },
    ),
  );
  expect(
    await screen.findByRole('region', { name: 'Diff viewer' }),
  ).toBeInTheDocument();
  expect(allChangesOf(repository.id)).toBeUndefined();
});
