import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import App from '../App';
import { Providers } from '../providers';
import { QueryProvider } from '../providers/QueryProvider';
import { useTabs } from '../stores/tabs';
import { useErrors } from '../stores/errors';
import { useDiffView } from '../stores/diff-view';
import { mockCommand, dialog, calls, emit } from './harness';
import { settings, status, repository, diff } from './fixtures';
import { DiffPane } from '../components/diff/DiffPane';
import { ImageDiff } from '../components/image/ImageDiff';
function setup() {
  mockCommand('env', () => ({
    found: true,
    supported: true,
    version: '2.50.1',
  }));
  mockCommand('settings_get', () => settings);
  mockCommand('status', () => status);
  mockCommand('stashes', () => []);
  mockCommand('history', () => ({ commits: [], cursor: null }));
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
function mountApp() {
  return render(
    <Providers>
      <App />
    </Providers>,
  );
}
describe('application shell', () => {
  it('blocks on absent and outdated Git', async () => {
    setup();
    mockCommand('env', () => ({ found: false, supported: false, version: '' }));
    mountApp();
    expect(await screen.findByText('Git is not installed')).toBeVisible();
    expect(screen.queryByLabelText('Filter files')).not.toBeInTheDocument();
  });
  it('opens a repository and stages and commits through typed IPC', async () => {
    setup();
    mockCommand('repo_open', () => repository);
    mockCommand('files_action', () => null);
    mockCommand('commit', () => 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    dialog.path = '/fixture';
    const user = userEvent.setup();
    mountApp();
    await screen.findByText('No repository open');
    await user.click(
      screen.getAllByRole('button', { name: 'Open repository' }).at(-1)!,
    );
    await screen.findByLabelText('Commit message');
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
    await user.click(
      screen.getByRole('button', { name: /Refresh repository/ }),
    );
    await user.click(screen.getByTitle('Settings'));
    expect(
      await screen.findByRole('dialog', { name: 'Settings' }),
    ).toBeVisible();
  });
  it('keeps partly staged files in both groups and preserves draft on cancelled close', async () => {
    setup();
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
      expect(
        screen.queryByLabelText('Stage src/app.ts'),
      ).not.toBeInTheDocument(),
    );
  });
  it('makes conflicted repositories read only and reports errors', async () => {
    setup();
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
  it('stacks failures per tab as floating cards with details and recovery', async () => {
    setup();
    mockCommand('sync', () => null);
    let retried = false;
    useTabs.getState().open('/second', 'Second');
    useTabs.getState().open(repository.id, repository.name);
    const user = userEvent.setup();
    mountApp();
    await screen.findByLabelText('Commit message');
    act(() => {
      const { report } = useErrors.getState();
      report('/second', { category: 'refused', message: 'hidden failure' });
      report(repository.id, {
        category: 'refused',
        message:
          "To origin\n ! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'origin'",
      });
      report(
        repository.id,
        { category: 'network', message: 'fatal: offline' },
        {
          retry: async () => {
            retried = true;
          },
        },
      );
    });
    expect(await screen.findByText('Could not reach the remote')).toBeVisible();
    expect(screen.getByText('Push rejected')).toBeVisible();
    expect(screen.queryByText('Hidden failure')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Errors waiting' })).toBeVisible();
    const details = screen.getAllByRole('button', { name: 'Show details' });
    await user.click(details[0]);
    expect(screen.getByText('fatal: offline')).toBeVisible();
    await user.click(screen.getByLabelText('Copy error output'));
    expect(await screen.findByLabelText('Copied')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide details' }));
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    expect(retried).toBe(true);
    await waitFor(() =>
      expect(
        screen.queryByText('Could not reach the remote'),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Pull' }));
    expect(calls).toContainEqual({
      command: 'sync',
      args: { repo: repository.id, action: 'pull' },
    });
    await waitFor(() =>
      expect(screen.queryByText('Push rejected')).not.toBeInTheDocument(),
    );
    act(() => useTabs.getState().activate('/second'));
    expect(await screen.findByText('Hidden failure')).toBeVisible();
    await user.click(screen.getByLabelText('Dismiss error'));
    expect(useErrors.getState().scopes['/second']).toEqual([]);
  });
  it('names both branches of a conflicted merge and aborts it', async () => {
    setup();
    mockCommand('status', () => ({
      ...status,
      conflicted: true,
      merging: 'feature',
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
    mockCommand('merge_abort', () => null);
    const user = userEvent.setup();
    useTabs.getState().open(repository.id, repository.name);
    mountApp();
    expect(
      await screen.findByText(/Merging feature into main\. 1 path conflicts/),
    ).toBeVisible();
    expect(await screen.findByText('Conflicts')).toBeVisible();
    expect(screen.queryByText('Staged changes')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abort merge' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'merge_abort',
        args: { repo: repository.id },
      }),
    );
  });
});
describe('diff and images', () => {
  it('renders source-specific hunks and toggles split and unified modes', async () => {
    setup();
    mockCommand('hunk_action', () => null);
    const user = userEvent.setup();
    render(
      <QueryProvider>
        <DiffPane
          repo="/fixture"
          selection={{ path: 'src/app.ts', source: 'unstaged' }}
          settings={settings}
          disabled={false}
        />
      </QueryProvider>,
    );
    expect(await screen.findByText('index → working tree')).toBeVisible();
    await screen.findByTitle('Stage hunk');
    await user.click(screen.getByTitle('Stage hunk'));
    expect(calls.some((call) => call.command === 'hunk_action')).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'unified' }));
    expect(useDiffView.getState().mode).toBe('unified');
    await user.click(screen.getByTitle('Hide whitespace'));
    await user.click(screen.getByTitle('Word wrap'));
    await user.click(screen.getByTitle('Next change'));
    await user.click(screen.getByTitle('Previous change'));
    await user.click(screen.getByTitle('Expand context'));
  });
  it('explains binary and oversize files', async () => {
    setup();
    mockCommand('diff', ({ overrideLimit }) => ({
      ...diff,
      tooLarge: !overrideLimit,
      binary: Boolean(overrideLimit),
    }));
    const user = userEvent.setup();
    render(
      <QueryProvider>
        <DiffPane
          repo="/fixture"
          selection={{ path: 'binary', source: 'file' }}
          settings={settings}
          disabled={false}
        />
      </QueryProvider>,
    );
    await screen.findByText('File too large to diff');
    await user.click(screen.getByRole('button', { name: 'View anyway' }));
    expect(await screen.findByText('Binary file')).toBeVisible();
  });
  it('offers keyboard swipe and below-image blend controls', async () => {
    const user = userEvent.setup();
    render(
      <ImageDiff
        repo="/fixture"
        selection={{ path: 'picture.png', source: 'staged' }}
        diff={{ ...diff, image: true }}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'swipe' }));
    const slider = screen.getByRole('slider', { name: 'Swipe divider' });
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '51');
    await user.click(screen.getByRole('radio', { name: 'onion skin' }));
    fireEvent.change(screen.getByLabelText('Onion skin blend'), {
      target: { value: '75' },
    });
    expect(screen.getByText('75%')).toBeVisible();
    await user.click(screen.getByTitle('Zoom in'));
    await user.click(screen.getByTitle('Zoom out'));
    await user.click(screen.getByTitle('Fit image'));
  });
  it('refreshes cached status from events', async () => {
    setup();
    useTabs.getState().open(repository.id, repository.name);
    mountApp();
    await screen.findByLabelText('Commit message');
    mockCommand('status', () => ({ ...status, entries: [] }));
    await act(async () => {
      emit('repo://status-changed', { repo: repository.id });
    });
    expect(await screen.findByText('Working tree is clean')).toBeVisible();
  });
});
