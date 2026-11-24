import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { switchWorktree } from '../lib/repository';
import type { Applied } from '../lib/types';
import { useErrors } from '../stores/errors';
import { worktreeFixture } from './fixtures';
import { calls, dialog, mockCommand } from './harness';
import { runAction } from './workbench';
import {
  APPLIED_SIX,
  APPLY_BASE,
  APPLY_TREE,
  MAIN,
  activeTab,
  branchList,
  listed,
  menuFor,
  noticeTitles,
  openProject,
  setupWorktreeActions,
  uncommittedCount,
} from './worktree-helpers';

const CONFLICT_FILES = 2;
const CONFLICT_COUNT = 2;
const FORCE_LOCKED = 2;

function deferred<T>() {
  let resolveValue: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise: promise, resolve: resolveValue };
}

async function clickDeleteMenu(name: string, view = MAIN) {
  const user = await menuFor(name, view);
  await user.click(
    await screen.findByRole('menuitem', { name: 'Delete worktree…' }),
  );
}

function mockOverlappingApply() {
  const stashed = deferred<Applied>();
  mockCommand('worktree_apply', ({ smart }) => {
    if (!smart)
      throw {
        category: 'overlap',
        message: 'Main has changes to:\nsrc/app.ts\nsrc/lib.ts',
      };
    return stashed.promise;
  });
  return stashed;
}

it('applies a worktree to main from its row and undoes it from the toast', async () => {
  setupWorktreeActions();
  const applyPending = deferred<Applied>();
  const undoPending = deferred<null>();
  mockCommand('worktree_apply', () => applyPending.promise);
  mockCommand('worktree_unapply', () => undoPending.promise);
  await openProject();
  const user = await menuFor('hotfix');
  const apply = await screen.findByRole('menuitem', {
    name: 'Apply to main checkout',
  });
  expect(apply).toHaveAttribute(
    'title',
    'Apply all changes to fixture on main',
  );
  await user.click(apply);
  expect(calls).toContainEqual({
    command: 'worktree_apply',
    args: { repo: MAIN, source: '/wt/hotfix', target: MAIN, smart: false },
  });
  expect(await screen.findByText('Applying to main')).toBeVisible();
  expect(
    screen.getByText('Copying commits and uncommitted changes from hotfix.'),
  ).toBeVisible();
  expect(await screen.findByText('Applying to main…')).toBeVisible();
  act(() => applyPending.resolve(APPLIED_SIX));
  expect(await screen.findByText('Applied to main')).toBeVisible();
  expect(noticeTitles()).not.toContain('Applying to main');
  expect(screen.getByText('6 files changed in fixture.')).toBeVisible();
  expect(activeTab().view).toBe(MAIN);
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(calls).toContainEqual({
    command: 'worktree_unapply',
    args: { repo: MAIN, target: MAIN, base: APPLY_BASE, tree: APPLY_TREE },
  });
  expect(await screen.findByText('Undoing apply')).toBeVisible();
  expect(await screen.findByText('Undoing apply…')).toBeVisible();
  act(() => undoPending.resolve(null));
  expect(await screen.findByText('Undid apply')).toBeVisible();
  expect(noticeTitles()).toEqual(['Undid apply']);
});

it('disables apply when the worktree has nothing new and reports a no-op', async () => {
  setupWorktreeActions();
  await openProject();
  await menuFor('review');
  await waitFor(() =>
    expect(
      screen.getByRole('menuitem', { name: 'Apply to main checkout' }),
    ).toHaveAttribute('data-disabled'),
  );
  expect(screen.getByText('No changes since it split from main')).toBeVisible();
  mockCommand('worktree_apply', () => ({
    base: APPLY_BASE,
    tree: APPLY_TREE,
    files: 0,
    conflicts: 0,
  }));
  await runAction('apply:/wt/review', MAIN);
  expect(await screen.findByText('Nothing to apply')).toBeVisible();
});

it('asks before stashing overlapping main changes and shows conflicts in main', async () => {
  setupWorktreeActions();
  const stashed = mockOverlappingApply();
  await openProject();
  await act(() => switchWorktree(activeTab(), '/wt/hotfix'));
  const user = userEvent.setup();
  await runAction('apply:/wt/spike', '/wt/hotfix');
  const firstPrompt = await screen.findByRole('dialog', {
    name: 'Apply spike to main?',
  });
  expect(noticeTitles('/wt/hotfix')).toEqual([]);
  await user.click(within(firstPrompt).getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText('Apply cancelled')).toBeVisible();
  expect(screen.getByText('Main was not changed.')).toBeVisible();
  await runAction('apply:/wt/spike', '/wt/hotfix');
  const prompt = await screen.findByRole('dialog', {
    name: 'Apply spike to main?',
  });
  expect(within(prompt).getByText('src/lib.ts')).toBeVisible();
  await user.click(
    within(prompt).getByRole('button', { name: 'Stash and apply' }),
  );
  expect(calls).toContainEqual({
    command: 'worktree_apply',
    args: {
      repo: '/wt/hotfix',
      source: '/wt/spike',
      target: MAIN,
      smart: true,
    },
  });
  expect(await screen.findByText('Stashing main, then applying')).toBeVisible();
  expect(await screen.findByText('Stashing and applying…')).toBeVisible();
  act(() =>
    stashed.resolve({
      ...APPLIED_SIX,
      files: CONFLICT_FILES,
      conflicts: CONFLICT_COUNT,
    }),
  );
  expect(
    await screen.findByText('Applied to main with 2 conflicts'),
  ).toBeVisible();
  expect(noticeTitles('/wt/hotfix')).toEqual([
    'Applied to main with 2 conflicts',
  ]);
  expect(activeTab().view).toBe('/wt/hotfix');
  await user.click(screen.getByRole('button', { name: 'Show main' }));
  await waitFor(() => expect(activeTab().view).toBe(MAIN));
  mockCommand('worktree_apply', () => {
    throw { category: 'refused', message: 'Main is busy' };
  });
  await runAction('apply:/wt/spike', MAIN);
  await waitFor(() =>
    expect(useErrors.getState().scopes[MAIN]).toHaveLength(1),
  );
  expect(noticeTitles()).not.toContain('Applying to main');
});

it('confirms deletion with what is lost and leaves the worktree first', async () => {
  setupWorktreeActions();
  await openProject();
  await act(() => switchWorktree(activeTab(), '/wt/spike'));
  dialog.approved = false;
  await clickDeleteMenu('spike', '/wt/spike');
  await waitFor(() => expect(dialog.asked).toBe(1));
  expect(dialog.title).toBe('Delete worktree spike?');
  expect(dialog.message).toBe(
    '2 commits are on no branch and will be lost. This deletes the folder /wt/spike, including ignored files.',
  );
  expect(calls.some((call) => call.command === 'worktree_remove')).toBe(false);
  expect(await screen.findByText('Deletion cancelled')).toBeVisible();
  expect(screen.getByText('Kept worktree spike.')).toBeVisible();
  const removePending = deferred<null>();
  mockCommand('worktree_remove', () => removePending.promise);
  dialog.approved = true;
  await runAction('delete-worktree', '/wt/spike');
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'worktree_remove',
      args: { repo: MAIN, worktree: '/wt/spike', force: 0 },
    }),
  );
  expect(await screen.findByText('Deleting worktree spike')).toBeVisible();
  expect(noticeTitles()).not.toContain('Deletion cancelled');
  expect(await screen.findByText('Deleting worktree spike…')).toBeVisible();
  await runAction('branches', MAIN, { allowDisabled: true });
  const list = branchList();
  const row = within(list).getByRole('button', { name: /^spike/ });
  expect(row).toHaveTextContent('Deleting…');
  expect(row).toBeDisabled();
  expect(
    within(list).getByRole('button', { name: 'Actions for spike' }),
  ).toBeDisabled();
  act(() => removePending.resolve(null));
  expect(await screen.findByText('Deleted worktree spike')).toBeVisible();
  expect(noticeTitles()).not.toContain('Deleting worktree spike');
  expect(activeTab().view).toBe(MAIN);
  expect(activeTab().members).not.toContain('/wt/spike');
  const order = calls.map((call) => call.command);
  expect(order.lastIndexOf('repo_close')).toBeLessThan(
    order.indexOf('worktree_remove'),
  );
});

it('forces deletion of dirty and locked worktrees after saying so', async () => {
  setupWorktreeActions();
  await openProject();
  await clickDeleteMenu('hotfix');
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'worktree_remove',
      args: { repo: MAIN, worktree: '/wt/hotfix', force: 1 },
    }),
  );
  expect(dialog.message).toBe(
    `Its ${uncommittedCount('/wt/hotfix')} uncommitted changes will be lost. This deletes the folder /wt/hotfix, including ignored files. The branch fix is kept.`,
  );
  await clickDeleteMenu('release');
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'worktree_remove',
      args: { repo: MAIN, worktree: '/wt/release', force: FORCE_LOCKED },
    }),
  );
  expect(dialog.title).toBe('release is locked');
  expect(dialog.message).toBe(
    'Reason: “on drive”\n\nDelete it anyway? This deletes the folder /wt/release, including ignored files. The branch release is kept.',
  );
  mockCommand('worktree_remove', () => {
    throw { category: 'refused', message: 'Folder is in use' };
  });
  await clickDeleteMenu('review');
  await waitFor(() =>
    expect(useErrors.getState().scopes[MAIN]?.at(-1)?.error.message).toBe(
      'Folder is in use',
    ),
  );
  expect(noticeTitles()).not.toContain('Deleting worktree review');
  mockCommand('worktree_summary', () => {
    throw { category: 'refused', message: 'Summary failed' };
  });
  await clickDeleteMenu('review');
  await waitFor(() =>
    expect(useErrors.getState().scopes[MAIN]?.length).toBeGreaterThan(0),
  );
});

it('forgets a missing locked worktree that prune skips', async () => {
  setupWorktreeActions();
  listed.worktrees.push(
    worktreeFixture('/wt/agent', {
      branch: 'agent',
      missing: true,
      locked: 'claude agent',
    }),
  );
  await openProject();
  const user = await menuFor('agent');
  expect(
    screen.queryByRole('menuitem', { name: 'Apply to main checkout' }),
  ).toBeNull();
  await user.click(
    await screen.findByRole('menuitem', { name: 'Delete worktree…' }),
  );
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'worktree_remove',
      args: { repo: MAIN, worktree: '/wt/agent', force: FORCE_LOCKED },
    }),
  );
  expect(dialog.title).toBe('agent is locked');
  expect(dialog.message).toBe(
    'Reason: “claude agent”\n\nDelete it anyway? The folder /wt/agent is already gone, so only Git’s record of it is removed. The branch agent is kept.',
  );
  expect(calls).not.toContainEqual(
    expect.objectContaining({
      command: 'worktree_summary',
      args: expect.objectContaining({ repo: '/wt/agent' }),
    }),
  );
});
