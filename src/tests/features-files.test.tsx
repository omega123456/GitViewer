import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useTabs } from '../stores/tabs';
import { selectionOf } from '../stores/selection';
import { calls, callsFor, dialog, emit, mockCommand } from './harness';
import { repository, status } from './fixtures';
import { count, mountApp, runAction, setup } from './workbench';

const TWO_FILE_ACTIONS = 2;
const THREE_SYNC_CALLS = 3;

it('stages and reverts from visible sidebar controls, respecting cancellation', async () => {
  setup();
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByRole('button', { name: 'Stage all' }));
  expect(calls).toContainEqual({
    command: 'files_action',
    args: {
      repo: repository.id,
      paths: ['src/app.ts', 'new.txt'],
      action: 'stage',
    },
  });
  await user.click(
    screen.getAllByRole('button', { name: 'Discard all in src' })[0],
  );
  expect(calls).toContainEqual({
    command: 'files_action',
    args: { repo: repository.id, paths: ['src/app.ts'], action: 'revert' },
  });
  dialog.approved = false;
  await user.click(screen.getByRole('button', { name: 'Discard all changes' }));
  expect(count('files_action')).toBe(TWO_FILE_ACTIONS);
  dialog.approved = true;
  await user.click(screen.getByRole('button', { name: 'Discard all changes' }));
  expect(calls).toContainEqual({
    command: 'files_action',
    args: {
      repo: repository.id,
      paths: ['src/app.ts', 'new.txt'],
      action: 'revert',
    },
  });
  await user.click(screen.getByRole('button', { name: 'Discard new.txt' }));
  expect(calls).toContainEqual({
    command: 'files_action',
    args: { repo: repository.id, paths: ['new.txt'], action: 'revert' },
  });
  const print = new KeyboardEvent('keydown', {
    key: 'p',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(print);
  expect(print.defaultPrevented).toBe(true);
  const copy = new KeyboardEvent('keydown', {
    key: 'c',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(copy);
  expect(copy.defaultPrevented).toBe(false);
});

it('scopes bulk verbs to their own group and drops an empty group', async () => {
  setup();
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByRole('button', { name: 'Unstage all' }));
  expect(calls).toContainEqual({
    command: 'files_action',
    args: { repo: repository.id, paths: ['src/app.ts'], action: 'unstage' },
  });
  await user.click(
    screen.getByRole('button', { name: 'Discard all staged changes' }),
  );
  expect(calls).toContainEqual({
    command: 'files_action',
    args: { repo: repository.id, paths: ['src/app.ts'], action: 'revert' },
  });
  await user.type(screen.getByLabelText('Filter files'), 'new');
  expect(
    screen.queryByRole('button', { name: 'Unstage all' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Discard all staged changes' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stage all' })).toBeVisible();
  await user.clear(screen.getByLabelText('Filter files'));
  await user.type(screen.getByLabelText('Filter files'), 'zzz');
  expect(await screen.findByText('No files match the filter')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Stage all' }),
  ).not.toBeInTheDocument();
});

it('collapses and expands every folder of a group from its header', async () => {
  setup();
  const user = userEvent.setup();
  mountApp();
  const tree = await screen.findByRole('tree', { name: 'Changes' });
  await within(tree).findByRole('treeitem', { name: 'app.ts' });
  await user.click(
    screen.getByRole('button', { name: 'Collapse all Changes' }),
  );
  expect(
    within(tree).queryByRole('treeitem', { name: 'app.ts' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Expand all Changes' }));
  expect(
    await within(tree).findByRole('treeitem', { name: 'app.ts' }),
  ).toBeVisible();
  await user.type(screen.getByLabelText('Filter files'), 'new');
  expect(
    screen.queryByRole('button', { name: /all Changes$/ }),
  ).not.toBeInTheDocument();
});

it('expands a folder that appears after a status refresh', async () => {
  setup();
  let current = status;
  mockCommand('status', () => current);
  mountApp();
  const tree = await screen.findByRole('tree', { name: 'Changes' });
  await within(tree).findByRole('treeitem', { name: 'app.ts' });
  current = {
    ...status,
    entries: [
      ...status.entries,
      {
        kind: 'untracked',
        path: 'docs/guide.md',
        index: '?',
        worktree: '?',
      },
    ],
  };
  act(() => emit('repo://status-changed', { repo: repository.id }));
  expect(
    await within(tree).findByRole('treeitem', { name: 'guide.md' }),
  ).toBeVisible();
});

it('runs registered repository navigation, synchronization, and file actions', async () => {
  setup();
  useTabs.getState().open('/second', 'Second');
  useTabs.getState().activate(repository.id);
  const user = userEvent.setup();
  mountApp();
  await screen.findAllByLabelText('Commit message');
  await runAction('next-file');
  expect(selectionOf(repository.id, 'working')?.source).toBe('staged');
  await runAction('next-file');
  expect(selectionOf(repository.id, 'working')?.source).toBe('unstaged');
  await screen.findByTitle('Stage hunk');
  await runAction('stage');
  await runAction('unstage');
  dialog.approved = false;
  await runAction('discard-file');
  expect(count('files_action')).toBe(TWO_FILE_ACTIONS);
  dialog.approved = true;
  await runAction('discard-file');
  await runAction('all');
  await runAction('previous-file');
  for (const id of ['fetch', 'pull', 'push', 'refresh', 'next-tab'])
    await runAction(id);
  expect(useTabs.getState().active).toBe('/second');
  await runAction('previous-tab', '/second');
  expect(useTabs.getState().active).toBe(repository.id);
  expect(count('sync')).toBe(THREE_SYNC_CALLS);
  const refreshed = count('refresh');
  fireEvent.focus(window);
  await waitFor(() => expect(count('refresh')).toBe(refreshed + 1));
  await user.click(screen.getByLabelText('Close Second'));
  expect(useTabs.getState().tabs).toHaveLength(1);
});

it('names a stash from its dialog and falls back to the default name', async () => {
  setup();
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByTitle('Stash changes'));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Cancel',
    }),
  );
  expect(count('stash_save')).toBe(0);
  await user.click(screen.getByTitle('Stash changes'));
  await user.click(await screen.findByRole('button', { name: 'Stash' }));
  await runAction('stash');
  expect(await screen.findByLabelText('Name')).toHaveFocus();
  await user.keyboard('  WIP login  {Enter}');
  await waitFor(() =>
    expect(callsFor('stash_save')).toEqual([
      { repo: repository.id, message: 'Saved from GitViewer' },
      { repo: repository.id, message: 'WIP login' },
    ]),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
