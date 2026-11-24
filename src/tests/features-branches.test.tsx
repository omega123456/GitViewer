import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useSuccesses } from '../stores/successes';
import { checkout } from '../lib/checkout';
import {
  calls,
  callsFor,
  count,
  dialog,
  emit,
  lastError,
  mockCommand,
  pendingActivity,
} from './harness';
import { branchFixture, repository, settings, status } from './fixtures';
import { branches, mountApp, runAction, setup } from './workbench';

const CONFLICT_CHANGED_FILES = 12;
const DIVERGED_CHANGED_FILES = 2;
const SECOND_PREVIEW = 2;
const THIRD_PREVIEW = 3;
const TWO_DIALOGS = 2;
const PULLED_COMMITS = 2;

function noticeTitles() {
  return (useSuccesses.getState().scopes[repository.id] ?? []).map(
    (notice) => notice.title,
  );
}

it('tags the default branch and refuses to delete it', async () => {
  setup();
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('branches');
  await user.type(screen.getByLabelText('Filter branches'), 'origin/main');
  const row = await screen.findByRole('button', { name: /^origin\/main/ });
  expect(within(row).getByText('default')).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Actions for origin/main' }),
  );
  expect(
    await screen.findByRole('menuitem', { name: 'Delete branch' }),
  ).toHaveAttribute('aria-disabled', 'true');
});

it('filters branch groups, deletes a branch, and switches branches', async () => {
  setup();
  mockCommand('branch_switch', () => null);
  mockCommand('branch_delete', () => null);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('branches');
  expect(await screen.findByText('Local branches')).toBeVisible();
  expect(screen.getByText('Remote branches')).toBeVisible();
  await user.type(screen.getByLabelText('Filter branches'), 'feature');
  expect(screen.queryByText('Remote branches')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Actions for feature' }));
  await user.click(
    await screen.findByRole('menuitem', { name: 'Delete branch' }),
  );
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'branch_delete',
      args: { repo: repository.id, name: 'feature' },
    }),
  );
  await user.click(
    await screen.findByRole('button', { name: /feature.*local/ }),
  );
  expect(calls).toContainEqual({
    command: 'branch_switch',
    args: { repo: repository.id, name: 'feature' },
  });
});

it('validates new branch names and creates from another reference without switching', async () => {
  setup();
  mockCommand('branch_create', () => null);
  mockCommand('branch_switch', () => null);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('branches');
  await user.click(screen.getByRole('button', { name: 'New branch' }));
  const name = screen.getByLabelText('Name');
  expect(name).toHaveFocus();
  expect(screen.getByLabelText('Based on')).toHaveTextContent('maincurrent');
  await user.type(name, 'feature');
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'A branch named “feature” already exists.',
  );
  expect(
    screen.getByRole('button', { name: 'Create & switch' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Create options' })).toBeDisabled();
  await user.clear(name);
  await user.type(name, 'bad:name');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Not a valid branch name.',
  );
  await user.clear(name);
  await user.type(name, 'new feature');
  expect(name).toHaveValue('new-feature');
  expect(screen.getByText('Spaces become dashes.')).toBeVisible();
  await user.click(screen.getByLabelText('Based on'));
  expect(await screen.findByText('Remote')).toBeVisible();
  await user.click(screen.getByRole('option', { name: 'origin/main' }));
  await user.click(screen.getByRole('button', { name: 'Create options' }));
  await user.click(
    await screen.findByRole('menuitemradio', { name: 'Create only' }),
  );
  await user.click(screen.getByRole('button', { name: 'Create only' }));
  expect(calls).toContainEqual({
    command: 'branch_create',
    args: {
      repo: repository.id,
      name: 'new-feature',
      base: 'origin/main',
      checkout: false,
    },
  });
  expect(count('branch_switch')).toBe(0);
});

it('merges a branch after the preview, skips an up to date branch, and respects cancellation', async () => {
  setup();
  mockCommand('merge_preview', () => ({
    outcome: 'conflict' as const,
    changed: CONFLICT_CHANGED_FILES,
    conflicts: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
  }));
  mockCommand('branch_merge', () => true);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  const merge = async () => {
    await runAction('branches');
    await user.click(
      await screen.findByRole('button', { name: 'Actions for feature' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Merge into main' }),
    );
  };
  await merge();
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'branch_merge',
      args: { repo: repository.id, name: 'feature' },
    }),
  );
  dialog.approved = false;
  mockCommand('merge_preview', () => ({
    outcome: 'fastForward' as const,
    changed: 1,
    conflicts: [],
  }));
  await merge();
  await waitFor(() => expect(count('merge_preview')).toBe(SECOND_PREVIEW));
  expect(count('branch_merge')).toBe(1);
  dialog.approved = true;
  mockCommand('merge_preview', () => ({
    outcome: 'upToDate' as const,
    changed: 0,
    conflicts: [],
  }));
  await merge();
  await waitFor(() => expect(count('merge_preview')).toBe(THIRD_PREVIEW));
  expect(count('branch_merge')).toBe(1);
});

it('offers to merge the upstream when a pull finds diverged history', async () => {
  setup();
  mockCommand('sync', () => {
    throw {
      category: 'diverged',
      message: 'main and origin/main have diverged',
    };
  });
  mockCommand('merge_preview', () => ({
    outcome: 'commit' as const,
    changed: DIVERGED_CHANGED_FILES,
    conflicts: [],
  }));
  mockCommand('branch_merge', () => true);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('pull');
  expect(dialog.title).toBe('Pull');
  expect(dialog.message).toBe(
    'main and origin/main have diverged. Merge origin/main into main? GitViewer checked the result: 2 files change and nothing conflicts. This will create a merge commit on main.',
  );
  expect(calls).toContainEqual({
    command: 'merge_preview',
    args: { repo: repository.id, name: 'origin/main' },
  });
  expect(callsFor('branch_merge')).toEqual([
    { repo: repository.id, name: 'origin/main' },
  ]);
  expect(lastError(repository.id)).toBeUndefined();
  dialog.approved = false;
  await runAction('pull');
  expect(count('branch_merge')).toBe(1);
  mockCommand('sync', () => {
    throw { category: 'network', message: 'fatal: offline' };
  });
  await runAction('pull');
  expect(lastError(repository.id)?.message).toBe('fatal: offline');
  mockCommand('sync', () => 1);
  await user.click(await screen.findByRole('button', { name: /Retry/ }));
  await waitFor(() => expect(lastError(repository.id)).toBeUndefined());
  expect(count('branch_merge')).toBe(1);
});

it('announces every prune stage in a toast and removes gone branches', async () => {
  setup();
  mockCommand('branches', () => [
    ...branches,
    branchFixture('old', { upstream: 'origin/old', gone: true }),
  ]);
  let found = () => {};
  mockCommand(
    'branch_gone',
    () =>
      new Promise<string[]>((resolve) => {
        found = () => resolve(['old']);
      }),
  );
  let pruned = () => {};
  mockCommand(
    'branch_prune',
    () =>
      new Promise((resolve) => {
        pruned = () => resolve({ deleted: ['old'], kept: [] });
      }),
  );
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('branches');
  expect(await screen.findByText('remote deleted')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Prune' }));
  expect(await screen.findByText('Checking remote')).toBeVisible();
  act(() => found());
  expect(await screen.findByText('Pruning 1 local branch')).toBeVisible();
  expect(noticeTitles()).not.toContain('Checking remote');
  expect(dialog.title).toBe('Prune local branches');
  expect(dialog.message).toBe(
    'Delete 1 local branch with no remote branch?\n\nold\n\nGit keeps any branch with commits that are not in main.',
  );
  act(() => pruned());
  expect(await screen.findByText('Pruned 1 local branch')).toBeVisible();
  expect(noticeTitles()).not.toContain('Pruning 1 local branch');
  expect(calls).toContainEqual({
    command: 'branch_prune',
    args: { repo: repository.id, names: ['old'] },
  });
});

it('respects prune cancellation, empty results, network failure, and hides Prune without upstreams', async () => {
  setup();
  mockCommand('branches', () => [
    ...branches,
    branchFixture('old', { upstream: 'origin/old', gone: true }),
  ]);
  mockCommand('branch_gone', () => ['old']);
  mockCommand('branch_prune', () => ({ deleted: ['old'], kept: [] }));
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('branches');
  dialog.approved = false;
  await user.click(screen.getByRole('button', { name: 'Prune' }));
  expect(await screen.findByText('Prune cancelled')).toBeVisible();
  expect(screen.getByText('Kept 1 local branch.')).toBeVisible();
  expect(count('branch_prune')).toBe(0);
  mockCommand('branch_gone', () => []);
  await runAction('prune-branches');
  expect(await screen.findByText('No branches to prune')).toBeVisible();
  expect(dialog.asked).toBe(1);
  dialog.approved = true;
  mockCommand('branch_gone', () => ['old']);
  await runAction('prune-branches');
  expect(dialog.asked).toBe(TWO_DIALOGS);
  mockCommand('branch_gone', () => {
    throw { category: 'network', message: 'Could not resolve host' };
  });
  await runAction('prune-branches');
  await waitFor(() =>
    expect(lastError(repository.id)?.message).toBe('Could not resolve host'),
  );
  expect(noticeTitles()).not.toContain('Checking remote');
  mockCommand('branches', () =>
    branches.map((branch) => ({ ...branch, upstream: '' })),
  );
  act(() => emit('repo://head-changed', { repo: repository.id }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Prune' }),
    ).not.toBeInTheDocument(),
  );
});

it('asks in place before smart checkout and preserves the error on cancellation', async () => {
  setup();
  mockCommand('branch_switch', () => {
    throw {
      category: 'refused',
      message:
        'error: Your local changes to the following files would be overwritten by checkout:\n\tfile.txt\nAborting',
    };
  });
  mockCommand('smart_checkout', () => null);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  const switched = checkout(repository.id, 'feature');
  const card = await screen.findByRole('dialog', {
    name: 'Switch to feature?',
  });
  expect(within(card).getByText('file.txt')).toBeVisible();
  expect(
    within(card).getByRole('button', { name: 'Stash and switch' }),
  ).toHaveFocus();
  await user.click(
    within(card).getByRole('button', { name: 'Stash and switch' }),
  );
  await act(() => switched);
  expect(count('smart_checkout')).toBe(1);
  expect(pendingActivity()).toEqual([]);
  const cancelled = checkout(repository.id, 'feature');
  await screen.findByRole('dialog', { name: 'Switch to feature?' });
  await user.keyboard('{Escape}');
  await act(() => cancelled);
  expect(lastError(repository.id)?.message).toContain('file.txt');
  expect(count('smart_checkout')).toBe(1);
  mockCommand('branch_switch', () => {
    throw { category: 'refused', message: 'error: unknown branch' };
  });
  await act(() => checkout(repository.id, 'missing'));
  expect(lastError(repository.id)?.message).toBe('error: unknown branch');
  mockCommand('branch_switch', () => null);
  await act(() => checkout(repository.id, 'feature'));
  expect(lastError(repository.id)).toBeUndefined();
  expect(count('sync')).toBe(0);
});

it('pulls after checkout only when enabled and the branch tracks an upstream', async () => {
  setup();
  let current = status;
  mockCommand('status', () => current);
  mockCommand('settings_get', () => ({ ...settings, pullOnCheckout: true }));
  mockCommand('branch_switch', () => null);
  mockCommand('sync', () => PULLED_COMMITS);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await act(() => checkout(repository.id, 'feature'));
  expect(calls).toContainEqual({
    command: 'sync',
    args: { repo: repository.id, action: 'pull' },
  });
  expect(count('sync')).toBe(1);
  current = { ...status, upstream: null };
  await act(() => checkout(repository.id, 'feature'));
  expect(count('sync')).toBe(1);
  current = status;
  mockCommand('branch_switch', () => {
    throw { category: 'refused', message: 'would be overwritten' };
  });
  mockCommand('smart_checkout', () => {
    throw { category: 'refused', message: 'stash conflict' };
  });
  const switched = checkout(repository.id, 'feature');
  await user.click(
    await screen.findByRole('button', { name: 'Stash and switch' }),
  );
  await act(() => switched);
  expect(lastError(repository.id)?.message).toBe('stash conflict');
  expect(count('sync')).toBe(1);
});
