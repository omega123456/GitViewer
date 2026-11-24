import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { registeredActions } from '../lib/actions';
import { closeRepository, switchWorktree } from '../lib/repository';
import { track } from '../stores/activity';
import { useErrors } from '../stores/errors';
import { useTabs } from '../stores/tabs';
import { repository, worktreeFixture } from './fixtures';
import { callsFor, count, dialog, emit, mockCommand } from './harness';
import { assertElement, mountApp, runAction, setup } from './workbench';
import {
  MAIN,
  PRESENT_WORKTREE_COUNT,
  activeTab,
  branchList,
  branchRow,
  listed,
  openProject,
  setupProject,
  sidebarSlider,
  worktreeTrigger,
} from './worktree-helpers';

const BARE_PROJECT_MEMBERS = 2;

function reportReviewError() {
  act(() =>
    useErrors
      .getState()
      .report('/wt/review', { category: 'refused', message: 'nope' }),
  );
}

function trackSpikeFetch() {
  let stop = () => {};
  act(() => {
    stop = track('/wt/spike', 'sync', { repo: '/wt/spike', action: 'fetch' });
  });
  return stop;
}

it('opens every present worktree with the project and marks the others', async () => {
  setupProject();
  await openProject();
  expect(useTabs.getState().tabs).toHaveLength(1);
  expect(activeTab().members).toEqual([
    MAIN,
    '/wt/hotfix',
    '/wt/review',
    '/wt/spike',
    '/wt/release',
  ]);
  expect(activeTab().view).toBe(MAIN);
  expect(worktreeTrigger()).toHaveTextContent('fixture/main');
  expect(
    screen.getByRole('img', {
      name: 'Another worktree has uncommitted changes',
    }),
  ).toBeInTheDocument();
  expect(screen.getByText('fixture', { selector: 'footer *' })).toBeVisible();
  await runAction('branches');
  const list = await screen.findByLabelText('Branches');
  expect(within(list).getByText('Worktrees')).toBeVisible();
  expect(branchRow('fixture')).toBeDisabled();
  expect(branchRow('hotfix')).toHaveTextContent('fix3');
  expect(
    within(branchRow('hotfix')).getByRole('img', {
      name: 'Uncommitted changes',
    }),
  ).toBeInTheDocument();
  expect(branchRow('spike')).toHaveTextContent('3f9c2a1 detached');
  expect(
    within(branchRow('release')).getByRole('img', { name: 'Locked' }),
  ).toBeInTheDocument();
  expect(
    branchRow('release').querySelector('[title="on drive"]'),
  ).not.toBeNull();
  expect(branchRow('legacy')).toBeDisabled();
  expect(branchRow('legacy')).toHaveTextContent('missing');
  expect(
    within(branchRow('legacy')).getByRole('img', { name: 'Folder missing' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Filter worktrees and branches')).toBeVisible();
});

it('switches in place and keeps each worktree its own draft', async () => {
  setupProject();
  await openProject();
  act(() => useTabs.getState().setMessage(MAIN, 'main draft'));
  fireEvent.keyDown(sidebarSlider(), { key: 'ArrowRight' });
  await runAction('branches');
  fireEvent.click(
    within(await screen.findByLabelText('Branches')).getByRole('button', {
      name: /^hotfix/,
    }),
  );
  await waitFor(() => expect(activeTab().view).toBe('/wt/hotfix'));
  expect(screen.queryByLabelText('Branches')).toBeNull();
  expect(sidebarSlider()).toHaveAttribute('aria-valuenow', '310');
  expect(useTabs.getState().active).toBe(MAIN);
  expect(worktreeTrigger()).toHaveTextContent('hotfix/fix');
  expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
    '',
  );
  expect(screen.getByText('Switched to worktree hotfix')).toBeInTheDocument();
  expect(registeredActions(MAIN).some((entry) => entry.id === 'branches')).toBe(
    false,
  );
  await runAction(`worktree:${MAIN}`, '/wt/hotfix');
  expect(activeTab().view).toBe(MAIN);
  expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
    'main draft',
  );
});

it('sends a branch checked out elsewhere to its worktree and keeps it from deletion', async () => {
  setupProject();
  await openProject();
  const user = userEvent.setup();
  await runAction('branches');
  const list = branchList();
  await user.click(
    within(list).getByRole('button', { name: 'Actions for feature' }),
  );
  expect(
    await screen.findByRole('menuitem', { name: 'Delete branch' }),
  ).toHaveAttribute('data-disabled');
  expect(screen.getByText('Checked out in review')).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(
    within(list).getByRole('button', { name: /^feature.*in review/ }),
  );
  expect(activeTab().view).toBe('/wt/review');
  expect(screen.queryByLabelText('Branches')).toBeNull();
  expect(count('branch_switch')).toBe(0);
});

it('prunes missing worktrees through the main worktree', async () => {
  setupProject();
  await openProject();
  const user = userEvent.setup();
  await runAction('branches');
  await user.click(screen.getByRole('button', { name: 'Prune missing' }));
  expect(callsFor('worktree_prune')).toContainEqual({ repo: MAIN });
});

it('drops a worktree whose folder went missing and falls back to the main one', async () => {
  setupProject();
  await openProject();
  await act(() => switchWorktree(activeTab(), '/wt/review'));
  expect(activeTab().view).toBe('/wt/review');
  listed.worktrees = listed.worktrees.map((entry) =>
    entry.id === '/wt/review' ? { ...entry, missing: true } : entry,
  );
  act(() => emit('repo://status-changed', { repo: MAIN }));
  await waitFor(() => expect(activeTab().view).toBe(MAIN));
  expect(activeTab().members).not.toContain('/wt/review');
  expect(callsFor('repo_close')).toContainEqual({ repo: '/wt/review' });
  await waitFor(() =>
    expect(screen.getByText('Worktree review is missing')).toBeVisible(),
  );
  expect(screen.getByText('Showing fixture')).toBeVisible();
});

it('opens a worktree that appeared after the project before showing it', async () => {
  setupProject();
  await openProject();
  fireEvent.keyDown(sidebarSlider(), { key: 'ArrowLeft' });
  await act(() => switchWorktree(activeTab(), '/wt/late'));
  expect(activeTab().members).toContain('/wt/late');
  expect(activeTab().view).toBe('/wt/late');
  expect(sidebarSlider()).toHaveAttribute('aria-valuenow', '290');
  mockCommand('repo_open', () => {
    throw new Error('gone');
  });
  await act(() => switchWorktree(activeTab(), '/wt/later'));
  expect(activeTab().view).toBe('/wt/late');
});

it('rolls every worktree into the project tab indicators', async () => {
  setupProject();
  await openProject();
  act(() => useTabs.getState().open('/other', 'other'));
  const projectTab = screen.getByRole('tab', { name: /^fixture/ });
  expect(projectTab).toHaveAttribute(
    'title',
    'fixture · worktree fixture on main',
  );
  expect(
    within(assertElement(projectTab.parentElement)).getByRole('img', {
      name: 'Uncommitted changes',
    }),
  ).toBeInTheDocument();
  reportReviewError();
  expect(
    within(projectTab).getByRole('img', { name: 'Errors waiting' }),
  ).toBeInTheDocument();
  const stop = trackSpikeFetch();
  await waitFor(() =>
    expect(
      within(projectTab).getByRole('img', { name: 'Git operation running' }),
    ).toBeInTheDocument(),
  );
  act(() => stop());
});

it('marks running and failing worktrees in the menu and on the button', async () => {
  setupProject();
  await openProject();
  reportReviewError();
  expect(
    screen.getByRole('img', { name: 'Errors waiting in another worktree' }),
  ).toBeInTheDocument();
  const stop = trackSpikeFetch();
  await runAction('branches');
  expect(
    within(branchRow('review')).getByRole('img', { name: 'Errors waiting' }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      within(branchRow('spike')).getByRole('img', {
        name: 'Git operation running',
      }),
    ).toBeInTheDocument(),
  );
  act(() => stop());
});

it('filters worktrees with branches and lists palette entries', async () => {
  setupProject();
  await openProject();
  const user = userEvent.setup();
  const labels = registeredActions(MAIN)
    .filter((entry) => entry.id.startsWith('worktree'))
    .map((entry) => entry.label);
  expect(labels).toEqual([
    'Switch worktree…',
    'Switch to worktree hotfix',
    'Switch to worktree review',
    'Switch to worktree spike',
    'Switch to worktree release',
  ]);
  await runAction('worktrees', MAIN);
  await user.type(
    screen.getByLabelText('Filter worktrees and branches'),
    'release',
  );
  expect(
    within(branchList())
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual([expect.stringMatching(/^release/), '']);
});

it('lands a linked folder in its project tab', async () => {
  setupProject();
  await openProject();
  dialog.path = '/wt/spike';
  await runAction('open');
  expect(useTabs.getState().tabs).toHaveLength(1);
  expect(activeTab().view).toBe('/wt/spike');
  expect(worktreeTrigger()).toHaveTextContent('spike/3f9c2a1 · detached');
});

it('closes every worktree together after one confirmation', async () => {
  setupProject();
  await openProject();
  act(() => useTabs.getState().setMessage('/wt/hotfix', 'draft'));
  dialog.approved = false;
  await act(() => closeRepository(activeTab()));
  expect(dialog.asked).toBe(1);
  expect(useTabs.getState().tabs).toHaveLength(1);
  dialog.approved = true;
  await act(() => closeRepository(activeTab()));
  expect(callsFor('repo_close').map((args) => args.repo)).toEqual([
    MAIN,
    '/wt/hotfix',
    '/wt/review',
    '/wt/spike',
    '/wt/release',
  ]);
  expect(useTabs.getState().tabs).toEqual([]);
  expect(useTabs.getState().messages).toEqual({});
});

it('lists a bare project without opening it', async () => {
  setup();
  act(() => useTabs.getState().close(MAIN));
  listed.worktrees = [
    worktreeFixture('/srv/bare.git', { main: true, bare: true }),
    worktreeFixture('/wt/one', { branch: 'one' }),
    worktreeFixture('/wt/two', { branch: 'two' }),
  ];
  mockCommand('worktrees', () => listed.worktrees);
  mockCommand('repo_open', ({ path }) => ({
    ...repository,
    id: path,
    root: path,
    project: '/srv/bare.git',
  }));
  dialog.path = '/wt/one';
  mountApp();
  await screen.findByText('No repository open');
  await runAction('open');
  await waitFor(() =>
    expect(activeTab()?.members).toHaveLength(BARE_PROJECT_MEMBERS),
  );
  expect(activeTab().id).toBe('/srv/bare.git');
  fireEvent.keyDown(window, { key: 'b', metaKey: true });
  const bare = within(await screen.findByLabelText('Branches')).getByRole(
    'button',
    { name: /^bare\.git/ },
  );
  expect(bare).toBeDisabled();
  expect(bare).toHaveTextContent('bare');
});

it('keeps the present worktree count in step with the fixture list', () => {
  setupProject();
  const present = listed.worktrees.filter((entry) => !entry.missing);
  expect(present).toHaveLength(PRESENT_WORKTREE_COUNT);
});
