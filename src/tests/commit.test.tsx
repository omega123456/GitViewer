import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { Providers } from '../providers';
import { registeredActions } from '../lib/actions';
import type { SettingsResponse, Status } from '../lib/types';
import { useTabs } from '../stores/tabs';
import { calls, emit, mockCommand } from './harness';
import { repository, settings, status } from './fixtures';
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
  mockCommand('env', () => ({
    found: true,
    supported: true,
    version: '2.50.1',
  }));
  mockCommand('settings_get', () => stored);
  mockCommand('settings_set', (next) => {
    stored = { ...next, keyStored: stored.keyStored };
    emit('settings://changed', null);
    return next;
  });
  mockCommand('status', () => snapshot);
  mockCommand('tree', () => []);
  mockCommand('stashes', () => []);
  mockCommand('history', () => ({ commits: [], cursor: null }));
  mockCommand('branches', () => []);
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
  mockCommand('commit', () => null);
  mockCommand('sync', () => null);
  useTabs.getState().open(repository.id, repository.name);
  useTabs.getState().setMessage(repository.id, 'Ship it');
  return {
    get settings() {
      return stored;
    },
  };
}
function mount() {
  return render(
    <Providers>
      <App />
    </Providers>,
  );
}
function commands() {
  return calls.map((call) => call.command);
}
async function run(id: string) {
  await act(async () => {
    const entry = registeredActions(repository.id).find(
      (entry) => entry.id === id,
    );
    expect(entry, id).toBeDefined();
    await entry?.run();
  });
}
describe('commit with nothing staged', () => {
  it('asks before staging everything and commits on confirmation', async () => {
    setup(unstaged);
    const user = userEvent.setup();
    mount();
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
    await user.click(
      screen.getByRole('button', { name: 'Stage all & commit' }),
    );
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
    mount();
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
    mount();
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
    mount();
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
    mount();
    await user.click(
      await screen.findByRole('button', {
        name: 'Commit all 2 changes to main',
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Stage all & commit' }),
    );
    expect(await screen.findByText('git: index locked')).toBeVisible();
    expect(commands()).not.toContain('commit');
    expect(screen.getByLabelText('Commit message')).toHaveValue('Ship it');
  });
  it('switches the behaviour from the settings pane', async () => {
    const harness = setup(staged);
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Commit message');
    await user.click(screen.getByTitle('Settings'));
    await user.click(
      screen.getByRole('radio', { name: 'never', hidden: true }),
    );
    await waitFor(() => expect(harness.settings.smartCommit).toBe('never'));
  });
});
describe('commit and push', () => {
  it('pushes after committing once the mode is chosen from the menu', async () => {
    setup(staged);
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'Commit 1 file to main' });
    await user.click(screen.getByRole('button', { name: 'Commit options' }));
    await user.click(
      await screen.findByRole('menuitemradio', { name: /Commit & Push/ }),
    );
    const button = await screen.findByRole('button', {
      name: 'Commit & push 1 file to main',
    });
    expect(useTabs.getState().tabs[0]?.commitMode).toBe('commitPush');
    await user.click(button);
    await waitFor(() => expect(commands()).toContain('sync'));
    const push = calls.find((call) => call.command === 'sync');
    expect(push?.args).toEqual({ repo: repository.id, action: 'push' });
    expect(commands().indexOf('commit')).toBeLessThan(
      commands().indexOf('sync'),
    );
    expect(screen.getByLabelText('Commit message')).toHaveValue('');
    expect(screen.queryByText(/Push failed/)).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Commit 1 file to main' }),
    ).toBeVisible();
    expect(useTabs.getState().tabs[0]?.commitMode).toBe('commit');
  });
  it('reports a failed push without hiding the commit', async () => {
    setup(staged);
    mockCommand('sync', () => {
      throw { category: 'network', message: 'remote unreachable' };
    });
    mount();
    await screen.findByRole('button', { name: 'Commit 1 file to main' });
    await run('commit-push');
    expect(
      await screen.findByText('Committed. Push failed: remote unreachable'),
    ).toBeVisible();
    expect(screen.getByLabelText('Commit message')).toHaveValue('');
    expect(commands()).toContain('commit');
  });
  it('carries the shortcut mode through the staging prompt', async () => {
    setup(unstaged);
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'Commit all 2 changes to main' });
    await run('commit-push');
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
    mount();
    expect(
      await screen.findByRole('button', {
        name: 'Commit 1 file to (detached)',
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Commit options' }),
    ).toBeDisabled();
    expect(
      registeredActions(repository.id).find(
        (entry) => entry.id === 'commit-push',
      )?.disabled,
    ).toBe(true);
  });
});
