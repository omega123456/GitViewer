import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { LineCount, sumLines } from '../components/shared/LineCount';
import { GroupHeader } from '../components/shared/Section';
import { useFilterStore } from '../stores/filter';
import { emit, mockCommand } from './harness';
import { domRect, geometry } from './setup';
import { repository, status } from './fixtures';
import { assertElement, count, mountApp, setup } from './workbench';

const STAGED_ADDED = 2;
const APP_ADDED = 1240;
const UTIL_REMOVED = 12345;
const NEW_FILE_ADDED = 3;
const CONFLICT_LINES = 5;
const COMMIT_APP_ADDED = 4;
const COMMIT_APP_REMOVED = 2;
const TWO_MATCHES = 2;
const HEADER_ADDED = 18;
const HEADER_REMOVED = 4;
const HEADER_HEIGHT = 24;
const HEADER_PADDING = 8;
const HEADER_TITLE_WIDTH = 100;
const HEADER_STATS_LEFT = 114;
const HEADER_STATS_WIDTH = 40;
const HEADER_COUNT_MIN_LEFT = 158;
const HEADER_COUNT_WIDTH = 7;
const HEADER_FOLDS_GAP = 11;
const HEADER_FOLDS_WIDTH = 48;
const HEADER_FOLDS_RESERVE = 52;
const TIGHT_HEADER_WIDTH = 220;
const ROOMY_HEADER_WIDTH = 240;
const FRACTIONAL_START_WIDTH = 224.6;
const WIDTH_TIGHT_FIRST = 224.8;
const WIDTH_TIGHT_SECOND = 225.2;
const WIDTH_TIGHT_THIRD = 225.4;
const WIDTH_ROOMY = 225.6;
const WIDTH_RETURN_TIGHT = 224.9;
const FRACTIONAL_WIDTHS = [
  WIDTH_TIGHT_FIRST,
  WIDTH_TIGHT_SECOND,
  WIDTH_TIGHT_THIRD,
  WIDTH_ROOMY,
  WIDTH_TIGHT_SECOND,
  WIDTH_RETURN_TIGHT,
];
const INITIAL_HEADER_COUNT = 2;
const EXPANDED_HEADER_COUNT = 3;
const SUM_LINES_REMOVED = 2;

const working = {
  ...status,
  entries: [
    {
      kind: 'ordinary' as const,
      path: 'src/app.ts',
      index: 'M',
      worktree: 'M',
    },
    {
      kind: 'ordinary' as const,
      path: 'src/lib/util.ts',
      index: '.',
      worktree: 'M',
    },
    { kind: 'untracked' as const, path: 'new.txt', index: '?', worktree: '?' },
    { kind: 'ordinary' as const, path: 'logo.png', index: '.', worktree: 'M' },
    {
      kind: 'unmerged' as const,
      path: 'conflict.ts',
      stage: 'UU',
      modes: ['100644', '100644', '100644', '100644'],
      hashes: ['a', 'b', 'c'],
      index: 'C',
      worktree: 'C',
    },
  ],
};

function mockLines() {
  setup();
  mockCommand('status', () => working);
  mockCommand('line_stats', () => ({
    staged: { 'src/app.ts': [STAGED_ADDED, 1] },
    unstaged: {
      'src/app.ts': [APP_ADDED, 0],
      'src/lib/util.ts': [0, UTIL_REMOVED],
      'new.txt': [NEW_FILE_ADDED, 0],
      'logo.png': null,
      'conflict.ts': [CONFLICT_LINES, CONFLICT_LINES],
    },
  }));
}

function rowOf(name: string) {
  return assertElement(
    screen.getAllByRole('treeitem', { name })[0].closest('div'),
  );
}

function headerRect(left: number, width: number) {
  return domRect({ x: left, y: 0, width: width, height: HEADER_HEIGHT });
}

function isFoldsSlot(element: Element) {
  return (
    element.parentElement?.tagName === 'H3' &&
    element.querySelector('[aria-label="Expand all"]') !== null
  );
}

function headerChildRect(
  element: Element,
  parent: HTMLElement,
  headerWidth: number,
) {
  const folds = [...parent.children].find(isFoldsSlot);
  const shown = Boolean(folds && !folds.classList.contains('hidden'));
  const reserve = shown ? HEADER_FOLDS_RESERVE : 0;
  const countLeft = Math.max(
    HEADER_COUNT_MIN_LEFT,
    headerWidth - HEADER_PADDING - HEADER_COUNT_WIDTH - reserve,
  );
  if (element === parent.firstElementChild)
    return headerRect(HEADER_PADDING, HEADER_TITLE_WIDTH);
  if (element.getAttribute('title')?.includes('lines added'))
    return headerRect(HEADER_STATS_LEFT, HEADER_STATS_WIDTH);
  if (isFoldsSlot(element))
    return shown
      ? headerRect(countLeft + HEADER_FOLDS_GAP, HEADER_FOLDS_WIDTH)
      : headerRect(0, 0);
  return headerRect(countLeft, HEADER_COUNT_WIDTH);
}

function stubHeaderLayout(size: { width: number }) {
  geometry.rect = (element: Element) => {
    if (element.tagName === 'H3') return headerRect(0, size.width);
    const parent = element.parentElement;
    if (parent?.tagName !== 'H3') return headerRect(0, 0);
    return headerChildRect(element, parent, size.width);
  };
}

function renderHeader(itemCount: number) {
  return (
    <GroupHeader
      title="Staged changes"
      count={itemCount}
      lines={[HEADER_ADDED, HEADER_REMOVED]}
      folds={<button aria-label="Expand all">E</button>}
    />
  );
}

function foldsSlot() {
  return assertElement(
    screen.getByRole('button', { name: 'Expand all' }).parentElement,
  );
}

it('formats compact counts, one-sided counts, binaries and empty counts', () => {
  const { container, rerender } = render(<LineCount lines={[1, 0]} />);
  expect(screen.getByTitle('1 line added, 0 removed')).toHaveTextContent('+1');
  expect(container).not.toHaveTextContent('−');
  rerender(<LineCount lines={[APP_ADDED, UTIL_REMOVED]} />);
  expect(container).toHaveTextContent('+1.2k−12k');
  rerender(<LineCount lines={null} />);
  expect(screen.getByTitle('Binary file')).toHaveTextContent('bin');
  rerender(<LineCount lines={[0, 0]} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<LineCount lines={undefined} />);
  expect(container).toBeEmptyDOMElement();
  expect(sumLines(undefined, ['a'])).toBeUndefined();
  expect(
    sumLines({ a: [1, SUM_LINES_REMOVED], b: null }, ['a', 'b', 'c']),
  ).toEqual([1, SUM_LINES_REMOVED]);
});

it('shows per-file counts, header totals that ignore the filter, and collapsed folder sums', async () => {
  mockLines();
  const user = userEvent.setup();
  mountApp();
  const changes = await screen.findByTitle('1,243 lines added, 12,345 removed');
  expect(changes.closest('h3')).toHaveTextContent('Changes');
  expect(screen.getAllByTitle('2 lines added, 1 removed')).toHaveLength(
    TWO_MATCHES,
  );
  expect(
    within(rowOf('util.ts')).getByTitle('0 lines added, 12,345 removed'),
  ).toHaveTextContent('−12k');
  expect(within(rowOf('new.txt')).getByText('+3')).toBeInTheDocument();
  expect(within(rowOf('logo.png')).getByText('bin')).toBeInTheDocument();
  expect(
    within(rowOf('conflict.ts')).queryByText(/\+/),
  ).not.toBeInTheDocument();
  const folder = screen.getAllByRole('treeitem', { name: 'src' })[1];
  expect(
    within(folder).queryByTitle('1,240 lines added, 12,345 removed'),
  ).not.toBeInTheDocument();
  await user.click(folder);
  expect(
    within(folder).getByTitle('1,240 lines added, 12,345 removed'),
  ).toHaveClass('opacity-75');
  act(() => useFilterStore.getState().set(repository.id, 'util'));
  await waitFor(() =>
    expect(screen.queryByRole('treeitem', { name: 'new.txt' })).toBeNull(),
  );
  expect(
    screen.getByTitle('1,243 lines added, 12,345 removed'),
  ).toBeInTheDocument();
});

it('does not request counts outside working mode', async () => {
  mockLines();
  const user = userEvent.setup();
  mountApp();
  await screen.findByTitle('1,243 lines added, 12,345 removed');
  const beforeStats = count('line_stats');
  const beforeStatus = count('status');
  await user.click(screen.getByRole('tab', { name: /history/ }));
  act(() => emit('repo://status-changed', { repo: repository.id }));
  await waitFor(() => expect(count('status')).toBe(beforeStatus + 1));
  expect(count('line_stats')).toBe(beforeStats);
});

it('totals and lists the selected commit files', async () => {
  mockLines();
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M', 'src/b.ts': 'A' },
    lines: {
      'src/app.ts': [COMMIT_APP_ADDED, COMMIT_APP_REMOVED],
      'src/b.ts': [1, 0],
    },
  }));
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByRole('tab', { name: /history/ }));
  await user.click(await screen.findByText('Review commit'));
  const header = await screen.findByTitle('5 lines added, 2 removed');
  expect(header.closest('h3')).toHaveTextContent('Files in commit');
  const tree = screen.getByRole('tree', { name: 'Commit files' });
  expect(
    within(tree).getByTitle('4 lines added, 2 removed'),
  ).toBeInTheDocument();
  await user.click(within(tree).getByRole('treeitem', { name: 'src' }));
  expect(
    within(tree).getByTitle('5 lines added, 2 removed'),
  ).toBeInTheDocument();
});

it('hides the fold buttons only while the header runs out of room', () => {
  const size = { width: TIGHT_HEADER_WIDTH };
  stubHeaderLayout(size);
  const { rerender } = render(renderHeader(INITIAL_HEADER_COUNT));
  expect(foldsSlot()).toHaveClass('hidden');
  expect(screen.getByTitle('18 lines added, 4 removed')).toHaveClass(
    'group-hover/header:hidden',
  );
  size.width = ROOMY_HEADER_WIDTH;
  rerender(renderHeader(EXPANDED_HEADER_COUNT));
  expect(foldsSlot()).toHaveClass('flex');
  expect(foldsSlot()).not.toHaveClass('hidden');
  expect(screen.getByTitle('18 lines added, 4 removed')).not.toHaveClass(
    'group-hover/header:hidden',
  );
});

it('switches once per crossing on fractional, zoomed widths', () => {
  const size = { width: FRACTIONAL_START_WIDTH };
  stubHeaderLayout(size);
  const { rerender } = render(renderHeader(0));
  const states = FRACTIONAL_WIDTHS.map((width, index) => {
    size.width = width;
    rerender(renderHeader(index + 1));
    return foldsSlot().classList.contains('hidden') ? 'tight' : 'roomy';
  });
  expect(states).toEqual([
    'tight',
    'tight',
    'tight',
    'roomy',
    'roomy',
    'tight',
  ]);
});
