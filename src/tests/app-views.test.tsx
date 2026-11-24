import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { QueryProvider } from '../providers/QueryProvider';
import { useTabs } from '../stores/tabs';
import { useErrors } from '../stores/errors';
import { useDiffView } from '../stores/diff-view';
import { DiffPane } from '../components/diff/DiffPane';
import { ImageDiff } from '../components/image/ImageDiff';
import { calls, emit, emptyRepoMocks, mockCommand } from './harness';
import { diff, repository, settings, status } from './fixtures';
import { mountApp } from './workbench';

function setupAppMocks() {
  emptyRepoMocks();
  mockCommand('settings_get', () => settings);
  mockCommand('status', () => status);
  mockCommand('diff', () => diff);
  mockCommand('refresh', () => null);
}

it('stacks failures per tab as floating cards with details and recovery', async () => {
  setupAppMocks();
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
  setupAppMocks();
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

it('renders source-specific hunks and toggles split and unified modes', async () => {
  setupAppMocks();
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
  await user.click(screen.getByRole('tab', { name: 'unified' }));
  expect(useDiffView.getState().mode).toBe('unified');
  await user.click(screen.getByTitle('Hide whitespace'));
  await user.click(screen.getByTitle('Word wrap'));
  await user.click(screen.getByTitle('Next change'));
  await user.click(screen.getByTitle('Previous change'));
});

it('explains binary and oversize files', async () => {
  setupAppMocks();
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
  await user.click(screen.getByRole('tab', { name: 'swipe' }));
  const slider = screen.getByRole('slider', { name: 'Swipe divider' });
  slider.focus();
  await user.keyboard('{ArrowRight}');
  expect(slider).toHaveAttribute('aria-valuenow', '51');
  await user.click(screen.getByRole('tab', { name: 'onion skin' }));
  fireEvent.change(screen.getByLabelText('Onion skin blend'), {
    target: { value: '75' },
  });
  expect(screen.getByText('75%')).toBeVisible();
  await user.click(screen.getByTitle('Zoom in'));
  await user.click(screen.getByTitle('Zoom out'));
  await user.click(screen.getByTitle('Fit image'));
});

it('refreshes cached status from events', async () => {
  setupAppMocks();
  useTabs.getState().open(repository.id, repository.name);
  mountApp();
  await screen.findByLabelText('Commit message');
  mockCommand('status', () => ({ ...status, entries: [] }));
  await act(async () => {
    emit('repo://status-changed', { repo: repository.id });
  });
  expect(await screen.findByText('Working tree is clean')).toBeVisible();
});
