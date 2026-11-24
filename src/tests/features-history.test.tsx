import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format, formatDistanceToNowStrict, fromUnixTime } from 'date-fns';
import { expect, it } from 'vitest';
import { useLayout } from '../stores/layout';
import { useSelection, selectionOf, allChangesOf } from '../stores/selection';
import { initials } from '../components/shared/Avatar';
import { shortHash } from '../lib/git';
import { mockCommand } from './harness';
import { HASH_LENGTH, repository } from './fixtures';
import { assertElement, commit, mountApp, runAction, setup } from './workbench';

const HISTORY_WIDTH_AFTER_STEP = 450;
const SIDEBAR_WIDTH_AFTER_STEP = 290;
const FILES_HEIGHT_AFTER_STEP = 38;
const LANE_TWO = 2;
const LANE_THREE = 3;
const FAR_LANE = 7;

async function openSelectedFileHistory() {
  setup();
  useSelection
    .getState()
    .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
  const user = userEvent.setup();
  mountApp();
  await screen.findByTitle('Stage hunk');
  await runAction('file-history');
  await user.click(
    await within(await screen.findByLabelText('Commit history')).findByText(
      'Review commit',
    ),
  );
  return user;
}

it('remembers history selection and switches between commit files and all changes', async () => {
  const user = await openSelectedFileHistory();
  expect(selectionOf(repository.id, 'history')?.path).toBe('src/app.ts');
  const fileTree = await screen.findByRole('tree', { name: 'Commit files' });
  await within(fileTree).findByRole('treeitem', { name: 'app.ts' });
  expect(within(fileTree).getByText('M')).toBeInTheDocument();
  const folder = within(fileTree).getByRole('treeitem', { name: 'src' });
  await user.click(folder);
  expect(
    within(fileTree).queryByRole('treeitem', { name: 'app.ts' }),
  ).not.toBeInTheDocument();
  await user.click(folder);
  await user.click(within(fileTree).getByRole('treeitem', { name: 'app.ts' }));
  expect(
    within(fileTree)
      .getByRole('treeitem', { name: 'app.ts' })
      .querySelector('.w-accent'),
  ).not.toBeNull();
  expect(selectionOf(repository.id, 'history')?.revision).toBe(commit.hash);
  await user.click(
    screen.getByRole('button', { name: 'All changes in commit' }),
  );
  const stack = await screen.findByRole('region', {
    name: 'All changes in commit',
  });
  expect(selectionOf(repository.id, 'history')?.path).toBe('');
  await within(stack).findByText(shortHash(commit.hash));
  await within(stack).findByRole('button', { name: /app\.ts/ });
  expect(within(stack).queryByTitle('Stage hunk')).not.toBeInTheDocument();
  await user.click(within(fileTree).getByRole('treeitem', { name: 'app.ts' }));
  await screen.findByRole('region', { name: 'Diff viewer' });
  expect(allChangesOf(repository.id)).toBeUndefined();
  await user.click(screen.getByRole('button', { name: 'All files' }));
  await user.click(
    await within(await screen.findByLabelText('Commit history')).findByText(
      'Review commit',
    ),
  );
  await screen.findByRole('region', { name: 'All changes in commit' });
  expect(allChangesOf(repository.id)).toBe('commit');
});

it('keeps independent sidebar widths across history and working modes', async () => {
  const user = await openSelectedFileHistory();
  fireEvent.keyDown(screen.getByLabelText('Resize sidebar'), {
    key: 'ArrowRight',
  });
  expect(useLayout.getState().tabs[repository.id].historyWidth).toBe(
    HISTORY_WIDTH_AFTER_STEP,
  );
  await runAction('history');
  expect(selectionOf(repository.id, 'working')?.source).toBe('unstaged');
  fireEvent.keyDown(screen.getByLabelText('Resize sidebar'), {
    key: 'ArrowLeft',
  });
  await user.click(screen.getByRole('button', { name: /^Files/ }));
  fireEvent.keyDown(screen.getByLabelText('Resize files section'), {
    key: 'ArrowUp',
  });
  expect(useLayout.getState().tabs[repository.id].width).toBe(
    SIDEBAR_WIDTH_AFTER_STEP,
  );
  expect(useLayout.getState().tabs[repository.id].filesHeight).toBe(
    FILES_HEIGHT_AFTER_STEP,
  );
});

it('shows who made each commit and the full message of the selected one', async () => {
  setup();
  mockCommand('commit_detail', () => ({
    hash: commit.hash,
    author: 'Priya Raman',
    timestamp: commit.timestamp,
    subject: 'Review commit',
    body: 'First reason.\n\n- Second reason',
  }));
  mockCommand('history', () => ({
    commits: [{ ...commit, author: 'Priya Raman' }],
    cursor: null,
  }));
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('history');
  const list = await screen.findByLabelText('Commit history');
  const row = assertElement(
    (await within(list).findByText('Review commit')).closest('button'),
  );
  expect(within(row).getByText('Priya Raman')).toBeVisible();
  expect(within(row).getByText(initials('Priya Raman'))).toBeVisible();
  expect(
    within(row).getByText(
      formatDistanceToNowStrict(fromUnixTime(commit.timestamp), {
        addSuffix: true,
      }),
    ),
  ).toBeVisible();
  await user.click(row);
  const details = await screen.findByRole('region', {
    name: 'Commit details',
  });
  await within(details).findByRole('heading', { name: 'Review commit' });
  expect(within(details).getByText('Priya Raman')).toBeVisible();
  expect(within(details).getByText(commit.hash)).toBeVisible();
  expect(
    within(details).getByText(
      format(fromUnixTime(commit.timestamp), 'd MMM yyyy, HH:mm'),
    ),
  ).toBeVisible();
  expect(within(details).getByText(/First reason\./)).toHaveTextContent(
    'First reason. - Second reason',
  );
});

it('offers a retry when the commit details fail to load', async () => {
  setup();
  let failing = true;
  mockCommand('commit_detail', () => {
    if (failing) throw { category: 'git', message: 'bad object' };
    return {
      hash: commit.hash,
      author: commit.author,
      timestamp: commit.timestamp,
      subject: commit.subject,
      body: '',
    };
  });
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('history');
  await user.click(
    await within(await screen.findByLabelText('Commit history')).findByText(
      'Review commit',
    ),
  );
  const error = await screen.findByText('Could not load the commit details');
  failing = false;
  await user.click(
    within(assertElement(error.closest('p'))).getByRole('button', {
      name: /Retry/,
    }),
  );
  await screen.findByRole('region', { name: 'Commit details' });
});

it('draws lanes in line colours, hollows merges and marks lanes past the cap', async () => {
  setup();
  mockCommand('history', () => ({
    commits: [
      {
        ...commit,
        parents: ['b'.repeat(HASH_LENGTH), 'c'.repeat(HASH_LENGTH)],
        subject: 'Merge feature',
        color: LANE_TWO,
        segments: [
          { from: 0, to: 0, color: LANE_TWO },
          { from: 0, to: FAR_LANE, color: LANE_THREE },
        ],
      },
      {
        ...commit,
        hash: 'c'.repeat(HASH_LENGTH),
        subject: 'Far feature',
        refs: '',
        lane: FAR_LANE,
        color: LANE_THREE,
        entered: true,
        segments: [{ from: 0, to: 0, color: LANE_TWO }],
      },
    ],
    cursor: null,
  }));
  mountApp();
  await screen.findByLabelText('Commit message');
  await runAction('history');
  const list = await screen.findByLabelText('Commit history');
  await within(list).findByText('Far feature');
  expect(
    list
      .closest<HTMLElement>('[style]')
      ?.style.getPropertyValue('--graph-width'),
  ).toBe('118px');
  const merge = within(list).getByRole('img', { name: 'Lane 1' });
  expect(merge.querySelector('circle')).toHaveAttribute('r', '3.2');
  expect(merge.querySelector('circle')).toHaveClass('fill-sub');
  expect(merge.querySelector('path[d^="M 14 0"]')).toBeNull();
  expect(merge.querySelector('path[d="M 14 22 L 140 44"]')).toHaveClass(
    'stroke-lane-4',
  );
  expect(merge.querySelector('mask')).not.toBeNull();
  expect(within(list).getByText('main')).toHaveClass('text-lane-3');
  const far = within(list).getByRole('img', { name: 'Lane 8' });
  expect(far.querySelector('circle')).toBeNull();
  expect(far.querySelector('path[d^="M 111 18"]')).toHaveClass('fill-lane-4');
  expect(far.querySelector('path[d="M 140 0 L 140 22"]')).toHaveClass(
    'stroke-lane-4',
  );
});
