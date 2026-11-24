import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { milliseconds } from 'date-fns';
import { expect, it, vi } from 'vitest';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { allChangesOf, selectionOf } from '../stores/selection';
import { useDiffView } from '../stores/diff-view';
import { useSettingsNav } from '../stores/settings-nav';
import { track } from '../stores/activity';
import { calls, dialog, emit, lastError, mockCommand } from './harness';
import { repository, settings, status } from './fixtures';
import { assertElement, commit, mountApp, runAction, setup } from './workbench';

const ZOOMED_PERCENT = 125;
const FIVE_FILE_TABS = 5;
const STASH_HEIGHT_AFTER_UP = 28;
const STASH_DRAG_Y = 300;
const STASH_FILES_HEIGHT_AFTER_DOWN = 52;
const PUSHED_COMMITS = 3;
const TWO_STATUS_BARS = 2;
const REVEAL_DELAY_SECONDS = 0.3;
const HOLD_DELAY_SECONDS = 0.4;

function setupStashScenario() {
  setup();
  mockCommand('stashes', () => [
    {
      hash: 'stash-hash',
      selector: 'stash@{0}',
      message: 'Saved experiment',
      timestamp: commit.timestamp,
    },
  ]);
  mockCommand('stash_apply', ({ smart }) => {
    if (!smart)
      throw {
        category: 'smart_apply',
        message: 'Local changes need a smart apply',
      };
    return null;
  });
  mockCommand('stash_drop', () => null);
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M', 'notes.md': '?' },
    lines: {},
  }));
}

function stashMutationCount() {
  return calls.filter((call) => call.command.startsWith('stash_')).length;
}

it('persists each preference through the backend and refreshes from its event', async () => {
  setup();
  let preferences = settings;
  mockCommand('settings_get', () => preferences);
  mockCommand('settings_set', (next) => {
    preferences = { ...next, keyStored: settings.keyStored };
    emit('settings://changed', null);
    return next;
  });
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('settings');
  await user.click(screen.getByRole('radio', { name: 'dark' }));
  await waitFor(() =>
    expect(document.querySelector('main')).toHaveAttribute(
      'data-theme',
      'dark',
    ),
  );
  await user.click(screen.getByRole('radio', { name: 'compact' }));
  await user.click(screen.getByRole('radio', { name: 'unified' }));
  await user.click(screen.getByLabelText('Search ignored files'));
  await user.click(screen.getByLabelText('Pull on checkout'));
  await user.click(screen.getByLabelText('Zoom'));
  await user.click(await screen.findByRole('option', { name: '125%' }));
  await user.click(screen.getByLabelText('File tabs'));
  await user.click(await screen.findByRole('option', { name: '5' }));
  await user.click(screen.getByLabelText('Auto fetch'));
  await user.click(
    await screen.findByRole('option', { name: 'Every 5 minutes' }),
  );
  await waitFor(() =>
    expect(preferences).toEqual({
      ...settings,
      theme: 'dark',
      density: 'compact',
      diffMode: 'unified',
      searchIgnoredFiles: true,
      pullOnCheckout: true,
      zoom: ZOOMED_PERCENT,
      maxFileTabs: FIVE_FILE_TABS,
      autoFetchInterval: '5m',
    }),
  );
  const rail = screen.getByRole('navigation', { name: 'Settings sections' });
  expect(within(rail).getByRole('button', { name: 'General' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await user.click(within(rail).getByRole('button', { name: 'Updates' }));
  expect(await screen.findByRole('region', { name: 'Updates' })).toBeVisible();
  expect(useSettingsNav.getState().pane).toBe('updates');
  await user.click(screen.getByLabelText('Close dialog'));
  expect(useSettingsNav.getState().pane).toBe('general');
  expect(useDiffView.getState().mode).toBeNull();
});

it('resizes the stash section and lists files inside a selected stash', async () => {
  setupStashScenario();
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  expect(
    screen.queryByLabelText('Resize stash section'),
  ).not.toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: /Stashes/ }));
  const handle = screen.getByLabelText('Resize stash section');
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  expect(useLayout.getState().tabs[repository.id].stashHeight).toBe(
    STASH_HEIGHT_AFTER_UP,
  );
  fireEvent.pointerDown(handle);
  fireEvent.pointerMove(handle, { clientY: STASH_DRAG_Y });
  expect(handle).toHaveAttribute('aria-valuenow', '50');
  const stashRow = await screen.findByRole('button', {
    name: /Saved experiment/,
  });
  await user.click(stashRow);
  expect(
    assertElement(stashRow.parentElement).querySelector('.w-accent'),
  ).not.toBeNull();
  const fileTree = await screen.findByRole('tree', { name: 'Stash files' });
  await within(fileTree).findByRole('treeitem', { name: 'app.ts' });
  expect(
    within(fileTree).getByRole('treeitem', { name: 'notes.md' }),
  ).toHaveTextContent('U');
  const filesHandle = screen.getByLabelText('Resize stash files');
  fireEvent.keyDown(filesHandle, { key: 'ArrowDown' });
  expect(useLayout.getState().tabs[repository.id].stashFilesHeight).toBe(
    STASH_FILES_HEIGHT_AFTER_DOWN,
  );
  const folder = within(fileTree).getByRole('treeitem', { name: 'src' });
  await user.click(folder);
  expect(
    within(fileTree).queryByRole('treeitem', { name: 'app.ts' }),
  ).not.toBeInTheDocument();
  await user.click(folder);
  await user.click(within(fileTree).getByRole('treeitem', { name: 'app.ts' }));
  expect(selectionOf(repository.id, 'working')?.source).toBe('stash');
  await user.click(screen.getByLabelText('All changes in stash'));
  expect(allChangesOf(repository.id)).toBe('commit');
  await screen.findByRole('region', { name: 'All changes in stash' });
});

it('uses hash-addressed stash apply, pop, and drop with smart confirmation', async () => {
  setupStashScenario();
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByRole('button', { name: /Stashes/ }));
  await user.click(
    await screen.findByRole('button', { name: /Saved experiment/ }),
  );
  const smartApply = (pop: boolean) => ({
    command: 'stash_apply',
    args: { repo: repository.id, hash: 'stash-hash', pop: pop, smart: true },
  });
  const decide = async (label: string) => {
    const card = await screen.findByRole('dialog', {
      name: 'Combine with your changes?',
    });
    await user.click(within(card).getByRole('button', { name: label }));
  };
  await user.click(screen.getByLabelText('Apply stash@{0}'));
  await decide('Apply and combine');
  await waitFor(() => expect(calls).toContainEqual(smartApply(false)));
  dialog.approved = false;
  const gated = stashMutationCount();
  await runAction('apply-stash');
  await runAction('pop-stash');
  await runAction('drop-stash');
  expect(stashMutationCount()).toBe(gated);
  dialog.approved = true;
  await runAction('drop-stash');
  expect(calls).toContainEqual({
    command: 'stash_drop',
    args: { repo: repository.id, hash: 'stash-hash' },
  });
  await user.click(screen.getByLabelText('Pop stash@{0}'));
  await decide('Cancel');
  expect(calls).not.toContainEqual(smartApply(true));
  await user.click(screen.getByLabelText('Pop stash@{0}'));
  await decide('Pop and combine');
  await waitFor(() => expect(calls).toContainEqual(smartApply(true)));
  mockCommand('stash_apply', () => {
    throw { category: 'refused', message: 'error: conflict' };
  });
  await runAction('apply-stash');
  expect(lastError(repository.id)?.message).toBe('error: conflict');
  mockCommand('stash_apply', () => null);
  await runAction('apply-stash');
  expect(lastError(repository.id)).toBeUndefined();
  const dropped = stashMutationCount();
  await user.click(screen.getByLabelText('Drop stash@{0}'));
  expect(stashMutationCount()).toBeGreaterThan(dropped);
});

it('disables detached-head synchronization and displays failures honestly', async () => {
  setup();
  mockCommand('status', () => ({ ...status, branch: '(detached)' }));
  const user = userEvent.setup();
  mountApp();
  await screen.findByText('This commit will be created on detached HEAD.');
  expect(screen.getByRole('button', { name: /pull/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /push/i })).toBeDisabled();
  mockCommand('sync', () => {
    throw { category: 'authentication', message: 'Credentials rejected' };
  });
  await runAction('fetch');
  expect(await screen.findByText('Sign-in to the remote failed')).toBeVisible();
  expect(screen.getByText('Credentials rejected')).toBeVisible();
  await user.click(screen.getByLabelText('Dismiss error'));
  await waitFor(() =>
    expect(
      screen.queryByText('Sign-in to the remote failed'),
    ).not.toBeInTheDocument(),
  );
});

it('confirms finished actions with success cards beside failures', async () => {
  setup();
  mockCommand('stashes', () => [
    {
      hash: 'stash-hash',
      selector: 'stash@{0}',
      message: 'On main: tidy tests',
      timestamp: commit.timestamp,
    },
  ]);
  mockCommand('stash_drop', () => null);
  mockCommand('stash_restore', () => null);
  mockCommand('sync', () => PUSHED_COMMITS);
  const user = userEvent.setup();
  mountApp();
  await screen.findAllByLabelText('Commit message');
  await runAction('push');
  expect(await screen.findByText('Pushed to origin/main')).toBeVisible();
  expect(screen.getByText('3 commits')).toBeVisible();
  mockCommand('sync', () => {
    throw { category: 'network', message: 'fatal: unable to access' };
  });
  await runAction('fetch');
  expect(await screen.findByText('Could not reach the remote')).toBeVisible();
  mockCommand('sync', () => 0);
  await runAction('fetch');
  await runAction('fetch');
  await waitFor(() =>
    expect(
      screen.queryByText('Could not reach the remote'),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getAllByText('Fetched')).toHaveLength(1);
  expect(screen.getByText('Up to date')).toBeVisible();
  await user.click(assertElement(screen.getAllByLabelText('Dismiss').at(-1)));
  await waitFor(() =>
    expect(screen.queryByText('Pushed to origin/main')).not.toBeInTheDocument(),
  );
  await user.click(await screen.findByRole('button', { name: /Stashes/ }));
  await user.click(screen.getByLabelText('Drop stash@{0}'));
  expect(await screen.findByText('Stash dropped')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(calls).toContainEqual({
    command: 'stash_restore',
    args: {
      repo: repository.id,
      hash: 'stash-hash',
      message: 'On main: tidy tests',
    },
  });
  expect(await screen.findByText('Stash restored')).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByText('Stash dropped')).not.toBeInTheDocument(),
  );
});

function mockPendingSync() {
  let finish = () => {};
  mockCommand(
    'sync',
    () =>
      new Promise<null>((resolve) => {
        finish = () => resolve(null);
      }),
  );
  return () => finish();
}

function advanceDelay(seconds: number) {
  act(() => vi.advanceTimersByTime(milliseconds({ seconds: seconds })));
}

it('shows a running pull on its button, in the status bar, and on a background tab', async () => {
  setup();
  useTabs.getState().open('/second', 'Second');
  useTabs.getState().activate(repository.id);
  const finish = mockPendingSync();
  mountApp();
  await screen.findAllByLabelText('Commit message');
  vi.useFakeTimers();
  const [pull] = screen.getAllByRole('button', { name: /pull/i });
  const [push] = screen.getAllByRole('button', { name: /push/i });
  fireEvent.click(pull);
  expect(screen.getAllByText('Ready')).toHaveLength(TWO_STATUS_BARS);
  advanceDelay(REVEAL_DELAY_SECONDS);
  expect(pull).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('Pulling from origin/main')).toBeVisible();
  expect(push).toBeDisabled();
  expect(screen.getAllByText('Ready')).toHaveLength(1);
  act(() =>
    emit('sync://progress', {
      repo: repository.id,
      message: 'Receiving objects:  45% (9/20)',
      done: false,
    }),
  );
  expect(
    screen.getByText('Pulling from origin/main · Receiving'),
  ).toBeVisible();
  expect(
    screen.getByRole('progressbar', { name: 'Receiving' }),
  ).toHaveAttribute('aria-valuenow', '45');
  await act(async () => finish());
  expect(push).toBeEnabled();
  advanceDelay(HOLD_DELAY_SECONDS);
  expect(screen.getAllByText('Ready')).toHaveLength(TWO_STATUS_BARS);
  expect(pull).toHaveAttribute('aria-busy', 'false');
  let stop = () => {};
  act(() => {
    stop = track('/second', 'sync', { repo: '/second', action: 'push' });
  });
  advanceDelay(REVEAL_DELAY_SECONDS);
  expect(
    screen.getByRole('img', { name: 'Git operation running' }),
  ).toBeVisible();
  act(() => useTabs.getState().activate('/second'));
  expect(screen.getByText('Pushing to origin/main')).toBeVisible();
  act(() => stop());
  advanceDelay(HOLD_DELAY_SECONDS);
  expect(
    screen.queryByRole('img', { name: 'Git operation running' }),
  ).not.toBeInTheDocument();
});
