import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { calls, dialog } from './harness';
import { runAction } from './workbench';
import {
  MAIN,
  activeTab,
  branchList,
  openProject,
  setupProjectWithIdleBranch,
  setupWorktreeActions,
} from './worktree-helpers';

async function submitNewBranchWorktree(
  user: ReturnType<typeof userEvent.setup>,
) {
  await runAction('new-worktree', MAIN);
  const form = await screen.findByRole('dialog', { name: 'New worktree' });
  await user.click(within(form).getByRole('radio', { name: 'new branch' }));
  await user.type(within(form).getByLabelText('Branch name'), 'main');
  expect(
    within(form).getByText('A branch named “main” already exists.'),
  ).toBeVisible();
  await user.clear(within(form).getByLabelText('Branch name'));
  await user.type(within(form).getByLabelText('Branch name'), 'feature/x');
  await waitFor(() =>
    expect(within(form).getByLabelText('Folder')).toHaveValue(
      '/wt/fixture-feature-x',
    ),
  );
  await user.click(
    within(form).getByRole('button', { name: 'Create worktree options' }),
  );
  await user.click(
    await screen.findByRole('menuitemradio', { name: 'Create only' }),
  );
  await user.click(within(form).getByRole('button', { name: 'Create only' }));
  expect(calls).toContainEqual({
    command: 'worktree_add',
    args: {
      repo: MAIN,
      path: '/wt/fixture-feature-x',
      mode: 'new',
      branch: 'feature/x',
      base: 'main',
    },
  });
  expect(activeTab().view).toBe(MAIN);
}

it('creates a detached worktree beside the project by default and switches to it', async () => {
  setupWorktreeActions();
  await openProject();
  const user = userEvent.setup();
  await runAction('branches');
  const list = branchList();
  expect(
    within(list).queryByRole('button', { name: 'Actions for fixture' }),
  ).toBeNull();
  expect(
    within(list).getByRole('button', { name: 'Actions for legacy' }),
  ).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'New worktree' }));
  const form = await screen.findByRole('dialog', { name: 'New worktree' });
  expect(within(form).getByRole('radio', { name: 'detached' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const folder = within(form).getByLabelText('Folder');
  await waitFor(() => expect(folder).toHaveValue('/wt/fixture-3f9c2a1'));
  expect(within(form).getByText('3f9c2a1')).toBeVisible();
  await user.clear(folder);
  await user.type(folder, '/wt/taken');
  expect(
    await within(form).findByText(
      'This folder already exists and is not empty.',
    ),
  ).toBeVisible();
  expect(
    within(form).getByRole('button', { name: 'Create & switch' }),
  ).toBeDisabled();
  await user.clear(folder);
  await user.type(folder, '/wt/fresh');
  const create = within(form).getByRole('button', { name: 'Create & switch' });
  await waitFor(() => expect(create).toBeEnabled());
  await user.click(create);
  expect(calls).toContainEqual({
    command: 'worktree_add',
    args: {
      repo: MAIN,
      path: '/wt/fresh',
      mode: 'detached',
      branch: '',
      base: 'main',
    },
  });
  await waitFor(() => expect(activeTab().view).toBe('/wt/fresh'));
  expect(await screen.findByText('Created worktree fresh')).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'New worktree' })).toBeNull(),
  );
});

it('creates worktrees on a new or an existing branch without switching', async () => {
  setupProjectWithIdleBranch();
  await openProject();
  const user = userEvent.setup();
  await submitNewBranchWorktree(user);
  await runAction('new-worktree', MAIN);
  const form = await screen.findByRole('dialog', { name: 'New worktree' });
  expect(within(form).getByRole('radio', { name: 'detached' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.click(
    within(form).getByRole('radio', { name: 'existing branch' }),
  );
  expect(
    within(form).getByRole('button', { name: 'Create only' }),
  ).toBeDisabled();
  await user.click(within(form).getByLabelText('Branch'));
  expect(screen.queryByRole('option', { name: /^feature/ })).toBeNull();
  expect(screen.getByRole('option', { name: 'idle' })).toBeVisible();
  await user.click(screen.getByRole('option', { name: /^origin\/main/ }));
  expect(within(form).getByText('main', { selector: 'span' })).toBeVisible();
  await waitFor(() =>
    expect(within(form).getByLabelText('Folder')).toHaveValue(
      '/wt/fixture-main',
    ),
  );
  dialog.path = '/picked';
  await user.click(within(form).getByRole('button', { name: 'Choose…' }));
  await waitFor(() =>
    expect(within(form).getByLabelText('Folder')).toHaveValue('/picked'),
  );
  await user.click(within(form).getByRole('button', { name: 'Create only' }));
  expect(calls).toContainEqual({
    command: 'worktree_add',
    args: {
      repo: MAIN,
      path: '/picked',
      mode: 'existing',
      branch: 'origin/main',
      base: 'main',
    },
  });
});
