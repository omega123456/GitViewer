import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { selectionOf } from '../stores/selection';
import type { Comparison } from '../lib/types';
import { calls, callsFor, mockCommand } from './harness';
import { HASH_LENGTH, branchFixture, repository } from './fixtures';
import {
  branches,
  count,
  mountApp,
  renderStack,
  runAction,
  scrollerOf,
  setup,
  shown,
} from './workbench';

const TWO_FILES = 2;
const THREE_HIGHLIGHTS = 3;
const COMPARE_ADDITIONS = 4;
const NEW_FILE_ADDITIONS = 2;
const COMPARE_BASE_HASH = 'b'.repeat(HASH_LENGTH);
const COMPARE_TARGET_HASH = 't'.repeat(HASH_LENGTH);

function compareResponse(
  base: string,
  mergeBase: boolean,
): Promise<Comparison> | Comparison {
  if (base === 'isl')
    return Promise.reject(new Error('Needed a single revision'));
  if (base === 'island' && mergeBase) {
    return Promise.reject(
      new Error(
        'These branches have no common commit. Turn off "Since branches diverged" to compare them directly.',
      ),
    );
  }
  return {
    base: COMPARE_BASE_HASH,
    target: COMPARE_TARGET_HASH,
    files: [
      {
        path: 'src/app.ts',
        status: 'M',
        additions: COMPARE_ADDITIONS,
        deletions: 1,
      },
      {
        path: 'new.txt',
        status: 'A',
        additions: NEW_FILE_ADDITIONS,
        deletions: 0,
      },
    ],
  };
}

function setupBranchCompare() {
  setup();
  mockCommand('default_branch', () => 'main');
  mockCommand('branches', () => [...branches, branchFixture('island')]);
  mockCommand('compare_files', ({ base, mergeBase }) =>
    compareResponse(base, mergeBase),
  );
  useLayout.getState().update(repository.id, { compareTarget: 'feature' });
}

it('finds across every stacked file, reopens a collapsed file to reach a match, and closes with Escape', async () => {
  setup();
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M', 'new.txt': 'A' },
    lines: {},
  }));
  const user = userEvent.setup();
  const pane = await renderStack();
  await waitFor(() => expect(shown(pane, 'new value')).toBe(TWO_FILES));
  await runAction('find');
  const input = within(pane).getByRole('textbox', { name: 'Find in file' });
  expect(input).toHaveFocus();
  await user.click(within(pane).getByRole('button', { name: /new\.txt/ }));
  expect(shown(pane, 'new value')).toBe(1);
  const scroller = scrollerOf(pane);
  const scrollTo = vi.mocked(scroller.scrollTo);
  scrollTo.mockClear();
  await user.type(input, 'VALUE');
  const counter = within(within(pane).getByRole('search')).getByRole('status');
  const current = () =>
    [...pane.querySelectorAll('.bg-find-current')].map(
      (span) => span.textContent,
    );
  expect(counter).toHaveTextContent('1 of 4');
  expect(current()).toEqual(['value']);
  expect(scrollTo).toHaveBeenCalled();
  await runAction('find-next');
  await runAction('find-next');
  expect(counter).toHaveTextContent('3 of 4');
  expect(shown(pane, 'new value')).toBe(TWO_FILES);
  expect(current()).toEqual(['value']);
  expect(pane.querySelectorAll('.bg-find')).toHaveLength(THREE_HIGHLIGHTS);
  await runAction('find-previous');
  expect(counter).toHaveTextContent('2 of 4');
  await user.keyboard('{Escape}');
  expect(within(pane).queryByRole('search')).toBeNull();
  expect(current()).toEqual([]);
  expect(scroller).toHaveFocus();
});

async function openCompareTab() {
  setupBranchCompare();
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  await user.click(screen.getByRole('tab', { name: 'compare' }));
  const stack = await screen.findByRole('region', {
    name: 'All changes between branches',
  });
  return { user: user, stack: stack };
}

function setBaseBranch(value: string) {
  fireEvent.change(screen.getByLabelText('Base'), {
    target: { value: value },
  });
}

it('compares two branches from the sidebar, swaps them, and reads diffs against the resolved base', async () => {
  const { user, stack } = await openCompareTab();
  await within(stack).findByRole('button', { name: /app\.ts/ });
  const header = within(stack).getByRole('banner');
  expect(header).toHaveTextContent('2 files · +6 −1');
  expect(await screen.findByLabelText('Base')).toHaveValue('main');
  expect(screen.getByLabelText('Compare')).toHaveValue('feature');
  expect(calls).toContainEqual({
    command: 'compare_files',
    args: {
      repo: repository.id,
      base: 'main',
      target: 'feature',
      mergeBase: true,
    },
  });
  await user.click(screen.getByLabelText('Swap base and compare branches'));
  expect(screen.getByLabelText('Base')).toHaveValue('feature');
  expect(screen.getByLabelText('Compare')).toHaveValue('main');
  await user.click(screen.getByLabelText('Since branches diverged'));
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'compare_files',
      args: {
        repo: repository.id,
        base: 'feature',
        target: 'main',
        mergeBase: false,
      },
    }),
  );
  const list = await screen.findByRole('tree', { name: 'Changed files' });
  const row = await within(list).findByRole('treeitem', { name: /app\.ts/ });
  expect(within(row).getByText('M')).toBeVisible();
  expect(
    within(within(list).getByRole('treeitem', { name: /new\.txt/ })).getByText(
      'A',
    ),
  ).toBeVisible();
  expect(within(list).getByRole('treeitem', { name: 'src' })).toBeVisible();
  expect(calls).toContainEqual({
    command: 'diff_stack',
    args: {
      repo: repository.id,
      source: 'compare',
      base: COMPARE_BASE_HASH,
      revision: COMPARE_TARGET_HASH,
    },
  });
  await user.click(row);
  await screen.findByRole('region', { name: 'Diff viewer' });
  expect(count('diff')).toBe(0);
  expect(screen.queryByTitle('Stage hunk')).not.toBeInTheDocument();
});

it('handles identical, invalid, and disjoint branch comparisons and remembers state', async () => {
  const { user } = await openCompareTab();
  await user.click(screen.getByLabelText('Swap base and compare branches'));
  await user.click(screen.getByLabelText('Since branches diverged'));
  setBaseBranch('main');
  expect(await screen.findAllByText('Nothing to compare')).toHaveLength(
    TWO_FILES,
  );
  expect(
    callsFor('compare_files').filter(
      (args) => args.base === 'main' && args.target === 'main',
    ),
  ).toHaveLength(0);
  setBaseBranch('isl');
  await waitFor(() =>
    expect(screen.getByLabelText('Base')).toHaveAttribute(
      'aria-invalid',
      'true',
    ),
  );
  expect(screen.getByLabelText('Compare')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.queryByText(/Needed a single/)).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('tree', { name: 'Changed files' })).getByRole(
      'treeitem',
      { name: /app\.ts/ },
    ),
  ).toBeVisible();
  await user.click(screen.getByLabelText('Since branches diverged'));
  setBaseBranch('island');
  expect(await screen.findAllByText(/no common commit/)).toHaveLength(
    TWO_FILES,
  );
  await user.click(
    screen.getAllByRole('button', { name: 'Use the direct diff instead' })[0],
  );
  expect(useLayout.getState().tabs[repository.id].mergeBase).toBe(false);
  await within(
    await screen.findByRole('tree', { name: 'Changed files' }),
  ).findByRole('treeitem', { name: /app\.ts/ });
  await user.click(screen.getByRole('tab', { name: 'working tree' }));
  await user.click(screen.getByRole('tab', { name: 'compare' }));
  expect(screen.getByLabelText('Base')).toHaveValue('island');
  await runAction('branches');
  await user.click(await screen.findByTitle('Compare with feature'));
  expect(screen.getByLabelText('Base')).toHaveValue('feature');
  expect(screen.getByLabelText('Compare')).toHaveValue('main');
  await runAction('swap-compare');
  expect(screen.getByLabelText('Base')).toHaveValue('main');
  await runAction('history');
  await runAction('compare');
  expect(useLayout.getState().tabs[repository.id].mode).toBe('compare');
  act(() => useTabs.getState().close(repository.id));
  expect(useLayout.getState().tabs[repository.id]).toBeUndefined();
  expect(selectionOf(repository.id, 'compare')).toBeUndefined();
});
