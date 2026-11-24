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
import { useErrors } from '../stores/errors';
import { useActivity } from '../stores/activity';
import { calls, dialog, emptyRepoMocks, host, mockCommand } from './harness';
import {
  COMMIT_HASH,
  branchFixture,
  diff,
  repository,
  settings,
  status,
} from './fixtures';
import { assertElement, mountApp } from './workbench';

function setupShell() {
  emptyRepoMocks();
  mockCommand('settings_get', () => settings);
  mockCommand('status', () => status);
  mockCommand('tree', ({ path }) =>
    path === ''
      ? [
          {
            path: 'src',
            name: 'src',
            directory: true,
            ignored: false,
            status: 'M',
          },
          {
            path: 'ignored.txt',
            name: 'ignored.txt',
            directory: false,
            ignored: true,
            status: '',
          },
        ]
      : [
          {
            path: 'src/app.ts',
            name: 'app.ts',
            directory: false,
            ignored: false,
            status: 'M',
          },
        ],
  );
  mockCommand('diff', () => diff);
  mockCommand('refresh', () => null);
}

it('blocks on absent and outdated Git', async () => {
  setupShell();
  mockCommand('env', () => ({
    found: false,
    supported: false,
    version: '',
    minimum: '2.38',
  }));
  mountApp();
  expect(await screen.findByText('Git is not installed')).toBeVisible();
  expect(screen.getByText('Git 2.38 or newer is required.')).toBeVisible();
  expect(screen.queryByLabelText('Filter files')).not.toBeInTheDocument();
});

it('opens a repository and stages and commits through typed IPC', async () => {
  setupShell();
  mockCommand('repo_open', () => repository);
  mockCommand('files_action', () => null);
  mockCommand('commit', () => COMMIT_HASH);
  dialog.path = '/fixture';
  const user = userEvent.setup();
  mountApp();
  await screen.findByText('No repository open');
  expect(host.title).toBe('GitViewer');
  const openButton = assertElement(
    screen.getAllByRole('button', { name: 'Open repository' }).at(-1),
  );
  await user.click(openButton);
  await screen.findByLabelText('Commit message');
  expect(host.title).toBe('fixture — GitViewer');
  expect(await screen.findByLabelText('Stage src/app.ts')).toBeVisible();
  await user.click(screen.getByLabelText('Stage src/app.ts'));
  expect(calls.some((call) => call.command === 'files_action')).toBe(true);
  await user.type(screen.getByLabelText('Commit message'), 'Review changes');
  await user.click(
    screen.getByRole('button', { name: /Commit \d+ files? to/ }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Commit message')).toHaveValue(''),
  );
  await user.click(screen.getByTitle('Command palette'));
  expect(
    await screen.findByRole('dialog', { name: 'Command palette' }),
  ).toBeVisible();
  await user.type(screen.getByLabelText('Find command'), 'refresh');
  expect(
    screen
      .getByRole('button', { name: /Refresh repository/ })
      .querySelector('mark'),
  ).toHaveTextContent('Refresh');
  await user.click(screen.getByRole('button', { name: /Refresh repository/ }));
  await user.click(screen.getByTitle('Settings'));
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeVisible();
});

it('keeps partly staged files in both groups and preserves draft on cancelled close', async () => {
  setupShell();
  useTabs.getState().open(repository.id, repository.name);
  useTabs.getState().setMessage(repository.id, 'draft');
  dialog.approved = false;
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  expect(await screen.findByLabelText('Unstage src/app.ts')).toBeVisible();
  expect(screen.getByLabelText('Stage src/app.ts')).toBeVisible();
  await user.click(screen.getByLabelText('Close fixture'));
  expect(useTabs.getState().tabs).toHaveLength(1);
  await user.type(screen.getByLabelText('Filter files'), 'nothing');
  await waitFor(() =>
    expect(screen.queryByLabelText('Stage src/app.ts')).not.toBeInTheDocument(),
  );
});

it('makes conflicted repositories read only and reports errors', async () => {
  setupShell();
  mockCommand('status', () => ({
    ...status,
    conflicted: true,
    entries: [
      {
        kind: 'unmerged' as const,
        path: 'src/app.ts',
        stage: 'UU',
        modes: ['100644', '100644', '100644', '100644'],
        hashes: ['a', 'b', 'c'],
        index: 'C',
        worktree: 'C',
      },
    ],
  }));
  useTabs.getState().open(repository.id, repository.name);
  mountApp();
  expect(await screen.findByText(/paths have conflicts/)).toBeVisible();
  expect(
    screen.getByRole('button', { name: /Commit \d+ files? to/ }),
  ).toBeDisabled();
  await act(async () => {
    useErrors
      .getState()
      .report('app', { category: 'network', message: 'Offline' });
  });
  expect(await screen.findByText('Could not reach the remote')).toBeVisible();
  expect(screen.getByText('Offline')).toBeVisible();
  expect(screen.queryByText(/^network/)).not.toBeInTheDocument();
});

it('closes the branch popover when another tab is clicked', async () => {
  setupShell();
  mockCommand('branches', () => [
    branchFixture('main', { current: true, default: true }),
  ]);
  useTabs.getState().open('/second', 'Second');
  useTabs.getState().open(repository.id, repository.name);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await user.click(screen.getByRole('button', { name: 'main' }));
  expect(await screen.findByLabelText('Filter branches')).toBeVisible();
  await user.click(screen.getByRole('tab', { name: 'Second' }));
  await waitFor(() =>
    expect(screen.queryByLabelText('Filter branches')).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole('tab', { name: repository.name }));
  expect(screen.queryByLabelText('Filter branches')).not.toBeInTheDocument();
});

it('marks the selected repository tab with the accent bar and moves it with arrow keys', async () => {
  setupShell();
  useTabs.getState().open('/second', 'Second');
  useTabs.getState().open(repository.id, repository.name);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  const strip = screen.getByRole('tablist', { name: 'Open repositories' });
  const selected = within(strip).getByRole('tab', { name: repository.name });
  expect(selected).toHaveAttribute('aria-selected', 'true');
  expect(selected).toHaveAttribute('tabindex', '0');
  expect(selected.parentElement).toHaveClass(
    'before:h-accent',
    'before:bg-accent',
    'forced-colors:before:bg-highlight',
  );
  const other = within(strip).getByRole('tab', { name: 'Second' });
  expect(other).toHaveAttribute('aria-selected', 'false');
  expect(other).toHaveAttribute('tabindex', '-1');
  expect(other.parentElement).not.toHaveClass('before:bg-accent');
  selected.focus();
  await user.keyboard('{ArrowLeft}');
  expect(useTabs.getState().active).toBe('/second');
  expect(within(strip).getByRole('tab', { name: 'Second' })).toHaveFocus();
  await user.keyboard('{End}');
  expect(useTabs.getState().active).toBe(repository.id);
  await user.keyboard('a');
  expect(useTabs.getState().active).toBe(repository.id);
});

function setupRecentRepositories() {
  setupShell();
  mockCommand('status', ({ repo }) =>
    repo === '/work/third'
      ? { ...status, branch: 'feature/pets-rules', entries: [] }
      : status,
  );
  useTabs.getState().open('/work/second', 'second');
  useTabs.getState().open('/work/third', 'third');
  useTabs.getState().open(repository.id, repository.name);
  useTabs.getState().activate('/work/second');
  useTabs.getState().activate(repository.id);
  useErrors
    .getState()
    .report('/work/third', { category: 'refused', message: 'hidden' });
  useActivity.setState({
    scopes: {
      '/work/second': [
        {
          id: 1,
          command: 'sync',
          args: {},
          visible: true,
          held: false,
          done: false,
        },
      ],
    },
  });
}

it('switches between open repositories from the palette in recent order', async () => {
  setupRecentRepositories();
  const user = userEvent.setup();
  mountApp();
  await screen.findAllByLabelText('Commit message');
  fireEvent.keyDown(window, { key: 'F2', shiftKey: true });
  const palette = await screen.findByRole('dialog', {
    name: 'Command palette',
  });
  const input = within(palette).getByLabelText('Find repository');
  const rows = () =>
    within(palette)
      .getAllByRole('button')
      .map((row) => row.textContent);
  await waitFor(() =>
    expect(rows()).toEqual([
      expect.stringMatching(/^second\/work/),
      expect.stringMatching(/^third\/work.*feature\/pets-rules/),
      expect.stringMatching(/^fixture.*Current$/),
    ]),
  );
  expect(palette.querySelector('[data-current]')).toHaveTextContent(/^second/);
  expect(
    within(palette).getByRole('img', { name: 'Git operation running' }),
  ).toBeVisible();
  expect(
    within(palette).getByRole('img', { name: 'Errors waiting' }),
  ).toBeVisible();
  await user.type(input, 'zzz');
  expect(
    within(palette).getByText('No open repository matches “zzz”'),
  ).toBeVisible();
  expect(
    within(palette).getByText('Press ⌘+o to open another repository'),
  ).toBeVisible();
  await user.clear(input);
  await user.type(input, 'pets');
  expect(rows()).toEqual([expect.stringMatching(/^third/)]);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(useTabs.getState().active).toBe('/work/third');
  expect(useTabs.getState().recent).toEqual([
    '/work/third',
    repository.id,
    '/work/second',
  ]);
});
