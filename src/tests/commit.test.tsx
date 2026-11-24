import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { registeredActions } from '../lib/actions';
import type { SettingsResponse, Status } from '../lib/types';
import { useTabs } from '../stores/tabs';
import { calls, count, emit, emptyRepoMocks, mockCommand } from './harness';
import { COMMIT_HASH, repository, settings, status } from './fixtures';
import { mountApp, runAction } from './workbench';

const RETRIED_SYNC_COUNT = 2;

const unstaged: Status = {
  ...status,
  entries: [
    { kind: 'ordinary', path: 'src/app.ts', index: '.', worktree: 'M' },
    { kind: 'untracked', path: 'new.txt', index: '?', worktree: '?' },
  ],
};

const staged: Status = {
  ...status,
  entries: [
    { kind: 'ordinary', path: 'src/app.ts', index: 'M', worktree: '.' },
  ],
};

function setup(current: Status, preferences: SettingsResponse = settings) {
  let stored = preferences;
  let snapshot = current;
  emptyRepoMocks();
  mockCommand('settings_get', () => stored);
  mockCommand('settings_set', (next) => {
    stored = { ...next, keyStored: stored.keyStored };
    emit('settings://changed', null);
    return next;
  });
  mockCommand('status', () => snapshot);
  mockCommand('files_action', ({ paths }) => {
    snapshot = {
      ...snapshot,
      entries: snapshot.entries.map((entry) =>
        paths.includes(entry.path) ? { ...entry, index: 'A' } : entry,
      ),
    };
    emit('repo://status-changed', { repo: repository.id });
    return null;
  });
  mockCommand('commit', () => COMMIT_HASH);
  mockCommand('sync', () => null);
  useTabs.getState().open(repository.id, repository.name);
  useTabs.getState().setMessage(repository.id, 'Ship it');
  return {
    get settings() {
      return stored;
    },
  };
}

function commands() {
  return calls.map((call) => call.command);
}

it('asks before staging everything and commits on confirmation', async () => {
  setup(unstaged);
  const user = userEvent.setup();
  mountApp();
  const button = await screen.findByRole('button', {
    name: 'Commit all 2 changes to main',
  });
  expect(button).toBeEnabled();
  await user.click(button);
  const prompt = screen.getByRole('group', {
    name: 'Stage all and commit',
  });
  expect(prompt).toHaveTextContent(
    'Nothing is staged. Stage all 2 changes and commit?',
  );
  await user.click(screen.getByRole('button', { name: 'Not now' }));
  expect(
    screen.queryByRole('group', { name: 'Stage all and commit' }),
  ).not.toBeInTheDocument();
  expect(commands()).not.toContain('commit');
  await user.click(button);
  await user.click(screen.getByRole('button', { name: 'Stage all & commit' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Commit message')).toHaveValue(''),
  );
  const stage = calls.find((call) => call.command === 'files_action');
  expect(stage?.args).toEqual({
    repo: repository.id,
    paths: ['src/app.ts', 'new.txt'],
    action: 'stage',
  });
  expect(commands().indexOf('files_action')).toBeLessThan(
    commands().indexOf('commit'),
  );
  expect(commands()).not.toContain('sync');
  expect(commands()).not.toContain('settings_set');
});

it('remembers "Always" as a setting and then skips the prompt', async () => {
  const harness = setup(unstaged);
  const user = userEvent.setup();
  mountApp();
  await user.click(
    await screen.findByRole('button', {
      name: 'Commit all 2 changes to main',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Always' }));
  await waitFor(() => expect(harness.settings.smartCommit).toBe('always'));
  await waitFor(() => expect(commands()).toContain('commit'));
  await waitFor(() =>
    expect(
      screen.queryByRole('group', { name: 'Stage all and commit' }),
    ).not.toBeInTheDocument(),
  );
});

it('stages and commits without asking when the setting says always', async () => {
  setup(unstaged, { ...settings, smartCommit: 'always' });
  const user = userEvent.setup();
  mountApp();
  await user.click(
    await screen.findByRole('button', {
      name: 'Commit all 2 changes to main',
    }),
  );
  await waitFor(() => expect(commands()).toContain('commit'));
  expect(
    screen.queryByRole('group', { name: 'Stage all and commit' }),
  ).not.toBeInTheDocument();
});

it('keeps the button disabled when the setting says never', async () => {
  setup(unstaged, { ...settings, smartCommit: 'never' });
  mountApp();
  expect(
    await screen.findByRole('button', { name: 'Commit 0 files to main' }),
  ).toBeDisabled();
  expect(
    registeredActions(repository.id).find((entry) => entry.id === 'commit')
      ?.disabled,
  ).toBe(true);
});

it('stops before committing when staging fails', async () => {
  setup(unstaged);
  mockCommand('files_action', () => {
    throw { category: 'git', message: 'index locked' };
  });
  const user = userEvent.setup();
  mountApp();
  await user.click(
    await screen.findByRole('button', {
      name: 'Commit all 2 changes to main',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Stage all & commit' }));
  expect(await screen.findByText('Something went wrong')).toBeVisible();
  expect(screen.getByText('Index locked')).toBeVisible();
  expect(commands()).not.toContain('commit');
  expect(screen.getByLabelText('Commit message')).toHaveValue('Ship it');
});

it('switches the behaviour from the settings pane', async () => {
  const harness = setup(staged);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await user.click(screen.getByTitle('Settings'));
  await user.click(screen.getByRole('radio', { name: 'never', hidden: true }));
  await waitFor(() => expect(harness.settings.smartCommit).toBe('never'));
});

it('pushes after committing once the mode is chosen from the menu', async () => {
  setup(staged);
  const user = userEvent.setup();
  mountApp();
  await screen.findByRole('button', { name: 'Commit 1 file to main' });
  await user.click(screen.getByRole('button', { name: 'Commit options' }));
  await user.click(
    await screen.findByRole('menuitemradio', { name: /Commit & Push/ }),
  );
  const button = await screen.findByRole('button', {
    name: 'Commit & push 1 file to main',
  });
  expect(useTabs.getState().modes[repository.id]).toBe('commitPush');
  await user.click(button);
  await waitFor(() => expect(commands()).toContain('sync'));
  const push = calls.find((call) => call.command === 'sync');
  expect(push?.args).toEqual({ repo: repository.id, action: 'push' });
  expect(commands().indexOf('commit')).toBeLessThan(commands().indexOf('sync'));
  expect(screen.getByLabelText('Commit message')).toHaveValue('');
  expect(screen.queryByText(/Push failed/)).not.toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: 'Commit 1 file to main' }),
  ).toBeVisible();
  expect(useTabs.getState().modes[repository.id]).toBe('commit');
});

it('reports a failed push without hiding the commit', async () => {
  setup(staged);
  mockCommand('sync', () => {
    throw { category: 'network', message: 'remote unreachable' };
  });
  mountApp();
  await screen.findByRole('button', { name: 'Commit 1 file to main' });
  await runAction('commit-push');
  expect(await screen.findByText('Push failed')).toBeVisible();
  expect(
    screen.getByText('Your commit is saved. Remote unreachable'),
  ).toBeVisible();
  expect(screen.getByLabelText('Commit message')).toHaveValue('');
  expect(commands()).toContain('commit');
  mockCommand('sync', () => null);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: /Push again/ }));
  await waitFor(() => expect(count('sync')).toBe(RETRIED_SYNC_COUNT));
  expect(screen.queryByText('Push failed')).not.toBeInTheDocument();
});

it('offers a pull instead of pushing again when the remote rejects the push', async () => {
  setup(staged);
  mockCommand('sync', () => {
    throw {
      category: 'refused',
      message:
        "To origin\n ! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'origin'",
    };
  });
  mountApp();
  await screen.findByRole('button', { name: 'Commit 1 file to main' });
  await runAction('commit-push');
  expect(await screen.findByText('Push failed')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Push again/ }),
  ).not.toBeInTheDocument();
  mockCommand('sync', () => null);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Pull' }));
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'sync',
      args: { repo: repository.id, action: 'pull' },
    }),
  );
  expect(screen.queryByText('Push failed')).not.toBeInTheDocument();
});

it('carries the shortcut mode through the staging prompt', async () => {
  setup(unstaged);
  const user = userEvent.setup();
  mountApp();
  await screen.findByRole('button', { name: 'Commit all 2 changes to main' });
  await runAction('commit-push');
  await user.click(
    await screen.findByRole('button', { name: 'Stage all & commit' }),
  );
  await waitFor(() => expect(commands()).toContain('sync'));
  expect(commands().indexOf('files_action')).toBeLessThan(
    commands().indexOf('commit'),
  );
});

it('offers no push on detached HEAD', async () => {
  setup({ ...staged, branch: '(detached)', upstream: null });
  useTabs.getState().setCommitMode(repository.id, 'commitPush');
  mountApp();
  expect(
    await screen.findByRole('button', {
      name: 'Commit 1 file to (detached)',
    }),
  ).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Commit options' })).toBeDisabled();
  expect(
    registeredActions(repository.id).find((entry) => entry.id === 'commit-push')
      ?.disabled,
  ).toBe(true);
});
