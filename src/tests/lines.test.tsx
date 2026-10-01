import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LineCount, sumLines } from '../components/shared/LineCount';
import { GroupHeader } from '../components/shared/Section';
import { useFilterStore } from '../stores/filter';
import { emit, mockCommand } from './harness';
import { geometry } from './setup';
import { repository, status } from './fixtures';
import { count, mount, settled, setup } from './workbench';
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
    staged: { 'src/app.ts': [2, 1] },
    unstaged: {
      'src/app.ts': [1240, 0],
      'src/lib/util.ts': [0, 12345],
      'new.txt': [3, 0],
      'logo.png': null,
      'conflict.ts': [5, 5],
    },
  }));
}
function row(name: string) {
  return screen.getAllByRole('treeitem', { name })[0].closest('div')!;
}
describe('line counts', () => {
  it('formats compact counts, one-sided counts, binaries and empty counts', () => {
    const { container, rerender } = render(<LineCount lines={[1, 0]} />);
    expect(screen.getByTitle('1 line added, 0 removed')).toHaveTextContent(
      '+1',
    );
    expect(container).not.toHaveTextContent('−');
    rerender(<LineCount lines={[1240, 12345]} />);
    expect(container).toHaveTextContent('+1.2k−12k');
    rerender(<LineCount lines={null} />);
    expect(screen.getByTitle('Binary file')).toHaveTextContent('bin');
    rerender(<LineCount lines={[0, 0]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LineCount lines={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(sumLines(undefined, ['a'])).toBeUndefined();
    expect(sumLines({ a: [1, 2], b: null }, ['a', 'b', 'c'])).toEqual([1, 2]);
  });

  it('shows per-file counts, header totals that ignore the filter, and collapsed folder sums', async () => {
    mockLines();
    const user = userEvent.setup();
    mount();
    const changes = await screen.findByTitle(
      '1,243 lines added, 12,345 removed',
    );
    expect(changes.closest('h3')).toHaveTextContent('Changes');
    expect(screen.getAllByTitle('2 lines added, 1 removed')).toHaveLength(2);
    expect(
      within(row('util.ts')).getByTitle('0 lines added, 12,345 removed'),
    ).toHaveTextContent('−12k');
    expect(within(row('new.txt')).getByText('+3')).toBeInTheDocument();
    expect(within(row('logo.png')).getByText('bin')).toBeInTheDocument();
    expect(
      within(row('conflict.ts')).queryByText(/\+/),
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
    await settled();
    expect(
      screen.getByTitle('1,243 lines added, 12,345 removed'),
    ).toBeInTheDocument();
  });

  it('does not request counts outside working mode', async () => {
    mockLines();
    const user = userEvent.setup();
    mount();
    await screen.findByTitle('1,243 lines added, 12,345 removed');
    const before = count('line_stats');
    await user.click(screen.getByRole('radio', { name: /history/ }));
    act(() => emit('repo://status-changed', { repo: repository.id }));
    await settled();
    expect(count('line_stats')).toBe(before);
  });

  it('totals and lists the selected commit files', async () => {
    mockLines();
    mockCommand('commit_files', () => ({
      statuses: { 'src/app.ts': 'M', 'src/b.ts': 'A' },
      lines: { 'src/app.ts': [4, 2], 'src/b.ts': [1, 0] },
    }));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('radio', { name: /history/ }));
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

  function stubLayout(size: { width: number }) {
    const rect = (left: number, width: number) =>
      ({
        x: left,
        y: 0,
        left,
        top: 0,
        width,
        height: 24,
        right: left + width,
        bottom: 24,
      }) as DOMRect;
    const inHeader = (element: Element) =>
      element.parentElement?.tagName === 'H3';
    const folded = (element: Element) =>
      inHeader(element) &&
      element.querySelector('[aria-label="Expand all"]') !== null;
    geometry.rect = (element: Element) => {
      if (element.tagName === 'H3') return rect(0, size.width);
      if (!inHeader(element)) return rect(0, 0);
      const header = element.parentElement!;
      const folds = [...header.children].find(folded);
      const shown = Boolean(folds && !folds.classList.contains('hidden'));
      const countLeft = Math.max(158, size.width - 8 - 7 - (shown ? 52 : 0));
      if (element === header.firstElementChild) return rect(8, 100);
      if (element.getAttribute('title')?.includes('lines added'))
        return rect(114, 40);
      if (folded(element)) return shown ? rect(countLeft + 11, 48) : rect(0, 0);
      return rect(countLeft, 7);
    };
  }
  const header = (count: number) => (
    <GroupHeader
      title="Staged changes"
      count={count}
      lines={[18, 4]}
      folds={<button aria-label="Expand all">E</button>}
    />
  );
  const slot = () =>
    screen.getByRole('button', { name: 'Expand all' }).parentElement!;

  it('hides the fold buttons only while the header runs out of room', () => {
    const size = { width: 220 };
    stubLayout(size);
    const { rerender } = render(header(2));
    expect(slot()).toHaveClass('hidden');
    expect(screen.getByTitle('18 lines added, 4 removed')).toHaveClass(
      'group-hover/header:hidden',
    );
    size.width = 240;
    rerender(header(3));
    expect(slot()).toHaveClass('flex');
    expect(slot()).not.toHaveClass('hidden');
    expect(screen.getByTitle('18 lines added, 4 removed')).not.toHaveClass(
      'group-hover/header:hidden',
    );
  });

  it('switches once per crossing on fractional, zoomed widths', () => {
    const size = { width: 224.6 };
    stubLayout(size);
    const { rerender } = render(header(0));
    const states = [224.8, 225.2, 225.4, 225.6, 225.2, 224.9].map(
      (width, index) => {
        size.width = width;
        rerender(header(index + 1));
        return slot().classList.contains('hidden') ? 'tight' : 'roomy';
      },
    );
    expect(states).toEqual([
      'tight',
      'tight',
      'tight',
      'roomy',
      'roomy',
      'tight',
    ]);
  });
});
