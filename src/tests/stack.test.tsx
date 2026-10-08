import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryProvider } from '../providers/QueryProvider';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { useImageViews } from '../stores/image-view';
import { DiffPane } from '../components/diff/DiffPane';
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { client } from '../lib/query';
import { mockCommand, calls, emit } from './harness';
import { intersect, intersecting, release, workers } from './setup';
import { settings, status, repository, diff, stack } from './fixtures';
import type { CommitFiles, Diff, DiffStack } from '../lib/types';
import {
  commit,
  branches,
  setup,
  mount,
  settled,
  count,
  picture,
  height,
  shown,
  colored,
  renderStack,
  renderFile,
  restart,
  action,
} from './workbench';
describe('all changes pane', () => {
  it('shows a loading state until the commit file list arrives', async () => {
    setup();
    let release: (files: CommitFiles) => void = () => {};
    mockCommand(
      'commit_files',
      () => new Promise<CommitFiles>((resolve) => (release = resolve)),
    );
    render(
      <QueryProvider>
        <AllChangesPane
          repo={repository.id}
          stack="commit"
          commit={{ path: '', source: 'commit', revision: commit.hash }}
          status={status}
          settings={settings}
          disabled={false}
        />
      </QueryProvider>,
    );
    const pane = await screen.findByRole('region', {
      name: 'All changes in commit',
    });
    expect(within(pane).getByText('Loading changes')).toBeInTheDocument();
    expect(within(pane).queryByText('Nothing here')).not.toBeInTheDocument();
    await act(async () =>
      release({ statuses: { 'src/app.ts': 'A' }, lines: {} }),
    );
    await within(pane).findByRole('button', { name: /app\.ts/ });
    expect(within(pane).queryByText('Loading changes')).not.toBeInTheDocument();
  });
  it('keeps the scroll position when the stack response arrives after the user scrolled', async () => {
    setup();
    let release: (value: DiffStack) => void = () => {};
    mockCommand(
      'diff_stack',
      () => new Promise<DiffStack>((resolve) => (release = resolve)),
    );
    const pane = await renderStack();
    await waitFor(() => expect(count('diff_stack')).toBe(1));
    const scroller = pane.lastElementChild as HTMLDivElement;
    scroller.scrollTop = 480;
    const scrollTo = vi.mocked(scroller.scrollTo);
    scrollTo.mockClear();
    await act(async () => release(stack));
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 480 }),
    );
    expect(scrollTo).not.toHaveBeenCalledWith(
      expect.objectContaining({ top: 0 }),
    );
  });
  it('reads a whole commit stack in one request', async () => {
    setup();
    mockCommand('commit_files', () => ({
      statuses: { 'src/app.ts': 'M', 'new.txt': 'A' },
      lines: {},
    }));
    const pane = await renderStack();
    await waitFor(() => expect(shown(pane, 'new value')).toBe(2));
    expect(calls).toContainEqual({
      command: 'diff_stack',
      args: { repo: repository.id, source: 'commit', revision: commit.hash },
    });
    expect(count('diff_stack')).toBe(1);
    expect(count('diff')).toBe(0);
  });
  it('falls back to a per-file read for a settled missing entry near the viewport', async () => {
    for (const truncated of [true, false]) {
      setup();
      mockCommand('commit_files', () => ({
        statuses: { 'src/app.ts': 'M', 'lib.ts': 'M' },
        lines: {},
      }));
      mockCommand('diff_stack', () => ({
        files: { 'src/app.ts': diff },
        truncated,
      }));
      const first = await renderStack();
      await waitFor(() => expect(count('diff')).toBe(1));
      expect(calls).toContainEqual({
        command: 'diff',
        args: {
          repo: repository.id,
          path: 'lib.ts',
          source: 'commit',
          revision: commit.hash,
          context: 3,
        },
      });
      first.unmount();
      restart();
      intersecting.initially = false;
      const pane = await renderStack();
      await waitFor(() => expect(count('diff_stack')).toBe(1));
      const block = within(pane).getByRole('button', {
        name: /lib\.ts/,
      }).parentElement!.parentElement!;
      await act(settled);
      expect(count('diff')).toBe(0);
      act(() => intersect(block, true));
      expect(count('diff')).toBe(0);
      await waitFor(() => expect(count('diff')).toBe(1));
      act(() => intersect(block, false));
      await act(settled);
      act(() => emit('repo://head-changed', { repo: repository.id }));
      await waitFor(() => expect(count('diff_stack')).toBe(2));
      expect(count('diff')).toBe(1);
      pane.unmount();
      restart();
      intersecting.initially = true;
    }
    setup();
    mockCommand('commit_files', () => ({
      statuses: { 'src/app.ts': 'M', 'lib.ts': 'M' },
      lines: {},
    }));
    let fail: (error: Error) => void = () => {};
    mockCommand(
      'diff_stack',
      () => new Promise<DiffStack>((_, reject) => (fail = reject)),
    );
    const pane = await renderStack();
    await waitFor(() => expect(count('diff_stack')).toBe(1));
    await act(settled);
    expect(count('diff')).toBe(0);
    expect(within(pane).getAllByText('Loading…')).toHaveLength(2);
    await act(async () => fail(new Error('The stack failed')));
    expect(await within(pane).findAllByText('The stack failed')).toHaveLength(
      2,
    );
    expect(count('diff')).toBe(0);
  });
  it('reserves the estimated height until a surface nears the viewport, keeps it mounted after, and sizes images at once', async () => {
    setup();
    intersecting.initially = false;
    mockCommand('commit_files', () => ({
      statuses: {
        'src/app.ts': 'M',
        'photo.png': 'M',
      },
      lines: {},
    }));
    mockCommand('diff_stack', () => ({
      files: {
        'src/app.ts': diff,
        'photo.png': { ...picture, newDimensions: { width: 40, height: 30 } },
      },
      truncated: false,
    }));
    const pane = await renderStack();
    await waitFor(() => expect(count('diff_stack')).toBe(1));
    const block = within(pane).getByRole('button', {
      name: /app\.ts/,
    }).parentElement!.parentElement!;
    const image = within(pane).getByRole('button', {
      name: /photo\.png/,
    }).parentElement!.parentElement!;
    await waitFor(() =>
      expect(within(block).getByText('Loading…')).toHaveClass('h-virtual'),
    );
    expect(height(block)).toBe('64px');
    expect(within(image).queryByText('Loading…')).toBeNull();
    expect(within(image).getByAltText('After')).toHaveAttribute('width', '40');
    expect(within(image).getByAltText('After')).toHaveAttribute('height', '30');
    expect(shown(pane, 'new value')).toBe(0);
    act(() => intersect(block, true));
    await act(settled);
    expect(shown(block, 'new value')).toBe(1);
    act(() => intersect(block, false));
    await act(settled);
    expect(shown(block, 'new value')).toBe(1);
  });
  it('highlights a stacked file only near the viewport and drops stale tokens', async () => {
    setup();
    intersecting.initially = false;
    const changed = {
      ...diff,
      hunks: [
        {
          ...diff.hunks[0],
          lines: diff.hunks[0].lines.map((line) => ({
            ...line,
            content: `${line.content};`,
          })),
        },
      ],
    };
    let current: Diff = diff;
    mockCommand('diff_stack', () => ({
      files: { 'src/app.ts': current },
      truncated: false,
    }));
    const pane = await renderStack();
    await waitFor(() => expect(count('diff_stack')).toBe(1));
    const block = within(pane).getByRole('button', {
      name: /app\.ts/,
    }).parentElement!.parentElement!;
    await act(settled);
    expect(workers.jobs).toHaveLength(0);
    act(() => intersect(block, true));
    await act(settled);
    await waitFor(() => expect(colored(block)).toBeGreaterThan(0));
    const highlighted = workers.jobs.length;
    act(() => intersect(block, false));
    await act(settled);
    expect(colored(block)).toBeGreaterThan(0);
    current = changed;
    act(() => emit('repo://head-changed', { repo: repository.id }));
    await waitFor(() => expect(shown(block, 'new value;')).toBe(1));
    expect(colored(block)).toBe(0);
    expect(workers.jobs).toHaveLength(highlighted);
  });
  it('keeps the previous tokens of the file pane until new ones arrive', async () => {
    setup();
    render(
      <QueryProvider>
        <DiffPane
          repo={repository.id}
          selection={{ path: 'src/app.ts', source: 'unstaged' }}
          settings={settings}
          disabled={false}
        />
      </QueryProvider>,
    );
    const pane = await screen.findByRole('region', { name: 'Diff viewer' });
    await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
    const before = workers.jobs.length;
    workers.held = true;
    mockCommand('diff', () => ({ ...diff, newSize: 16 }));
    act(() => emit('repo://status-changed', { repo: repository.id }));
    await waitFor(() => expect(count('diff')).toBe(2));
    await waitFor(() => expect(workers.jobs.length).toBeGreaterThan(before));
    await waitFor(() => expect(workers.queued.length).toBeGreaterThan(0));
    expect(shown(pane, 'new value')).toBe(1);
    expect(colored(pane)).toBeGreaterThan(0);
    workers.held = false;
    await act(async () => release());
    await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
  });
  it('seeds a commit file from its loaded stack and fetches working-tree files', async () => {
    setup();
    const loaded = await renderStack();
    await waitFor(() => expect(shown(loaded, 'new value')).toBe(1));
    loaded.unmount();
    const selected = renderFile({
      path: 'src/app.ts',
      source: 'commit',
      revision: commit.hash,
    });
    const pane = await screen.findByRole('region', { name: 'Diff viewer' });
    expect(shown(pane, 'new value')).toBe(1);
    expect(count('diff')).toBe(0);
    selected.unmount();
    const working = await renderStack('unstaged');
    await waitFor(() => expect(count('diff_stack')).toBe(2));
    working.unmount();
    renderFile({ path: 'src/app.ts', source: 'unstaged' }).unmount();
    await waitFor(() => expect(count('diff')).toBe(1));
    act(() => {
      void client.invalidateQueries({
        queryKey: [repository.id, 'diff_stack'],
      });
    });
    renderFile({ path: 'new.txt', source: 'commit', revision: commit.hash });
    await waitFor(() => expect(count('diff')).toBe(2));
  });
  it('stacks every file of a group, collapses files, and returns on selection', async () => {
    setup();
    mockCommand('diff_stack', () => ({
      files: {
        'src/app.ts': diff,
        'new.txt': {
          ...diff,
          path: 'new.txt',
          image: true,
          hunks: [],
          patches: [],
        },
      },
      truncated: false,
    }));
    mockCommand('hunk_action', () => null);
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole('button', { name: 'All changes' }),
    );
    const pane = await screen.findByRole('region', { name: 'All changes' });
    await user.click(
      within(
        await within(pane).findByLabelText('Image comparison mode'),
      ).getByRole('radio', { name: 'swipe' }),
    );
    expect(useImageViews.getState().tabs[`${repository.id}:new.txt`].mode).toBe(
      'swipe',
    );
    expect(useImageViews.getState().tabs[repository.id]).toBeUndefined();
    act(() => useImageViews.getState().forget(repository.id));
    expect(
      useImageViews.getState().tabs[`${repository.id}:new.txt`],
    ).toBeUndefined();
    await user.click(await within(pane).findByTitle('Stage hunk'));
    expect(calls).toContainEqual({
      command: 'hunk_action',
      args: {
        repo: repository.id,
        path: 'src/app.ts',
        source: 'unstaged',
        hunk: 0,
        patch: 'patch',
        action: 'stage',
      },
    });
    mockCommand('system_open', () => null);
    const header = within(pane).getByRole('button', {
      name: /app\.ts/,
    }).parentElement!;
    await user.click(within(header).getByLabelText('Copy file path'));
    expect(await navigator.clipboard.readText()).toBe('src/app.ts');
    await user.click(within(header).getByRole('button', { name: 'Open' }));
    expect(calls).toContainEqual({
      command: 'system_open',
      args: { repo: repository.id, path: 'src/app.ts' },
    });
    await user.click(within(pane).getByRole('button', { name: /app\.ts/ }));
    expect(within(pane).queryByTitle('Stage hunk')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'All staged changes' }),
    );
    await screen.findByRole('region', { name: 'All staged changes' });
    await user.click(
      within(screen.getByRole('tree', { name: 'Changes' })).getByRole(
        'treeitem',
        { name: 'app.ts' },
      ),
    );
    expect(
      await screen.findByRole('region', { name: 'Diff viewer' }),
    ).toBeInTheDocument();
    expect(useSelection.getState().all[repository.id]).toBeUndefined();
  });
  it('compares two branches from the sidebar, swaps them, and reads diffs against the resolved base', async () => {
    setup();
    mockCommand('default_branch', () => 'main');
    mockCommand('branches', () => [
      ...branches,
      {
        name: 'island',
        current: false,
        remote: false,
        upstream: '',
        gone: false,
      },
    ]);
    mockCommand('compare_files', ({ base, mergeBase }) =>
      (base === 'island' && mergeBase) || base === 'isl'
        ? Promise.reject(
            new Error(
              base === 'isl'
                ? 'Needed a single revision'
                : 'These branches have no common commit. Turn off "Since branches diverged" to compare them directly.',
            ),
          )
        : {
            base: 'b'.repeat(40),
            target: 't'.repeat(40),
            files: [
              { path: 'src/app.ts', status: 'M', additions: 4, deletions: 1 },
              { path: 'new.txt', status: 'A', additions: 2, deletions: 0 },
            ],
          },
    );
    const user = userEvent.setup();
    useLayout.getState().update(repository.id, { compareTarget: 'feature' });
    mount();
    await screen.findByLabelText('Commit message');
    await user.click(screen.getByRole('radio', { name: 'compare' }));
    const stack = await screen.findByRole('region', {
      name: 'All changes between branches',
    });
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
      within(
        within(list).getByRole('treeitem', { name: /new\.txt/ }),
      ).getByText('A'),
    ).toBeVisible();
    expect(within(list).getByRole('treeitem', { name: 'src' })).toBeVisible();
    expect(calls).toContainEqual({
      command: 'diff_stack',
      args: {
        repo: repository.id,
        source: 'compare',
        base: 'b'.repeat(40),
        revision: 't'.repeat(40),
      },
    });
    await user.click(row);
    await screen.findByRole('region', { name: 'Diff viewer' });
    expect(count('diff')).toBe(0);
    expect(screen.queryByTitle('Stage hunk')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('All changes between branches'));
    await screen.findByRole('region', { name: 'All changes between branches' });
    fireEvent.change(screen.getByLabelText('Base'), {
      target: { value: 'main' },
    });
    expect(await screen.findAllByText('Nothing to compare')).toHaveLength(2);
    expect(
      calls.filter(
        (call) =>
          call.command === 'compare_files' &&
          (call.args as { base: string; target: string }).base === 'main' &&
          (call.args as { base: string; target: string }).target === 'main',
      ),
    ).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Base'), {
      target: { value: 'isl' },
    });
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
    fireEvent.change(screen.getByLabelText('Base'), {
      target: { value: 'island' },
    });
    expect(await screen.findAllByText(/no common commit/)).toHaveLength(2);
    await user.click(
      screen.getAllByRole('button', { name: 'Use the direct diff instead' })[0],
    );
    expect(useLayout.getState().tabs[repository.id].mergeBase).toBe(false);
    await within(
      await screen.findByRole('tree', { name: 'Changed files' }),
    ).findByRole('treeitem', { name: /app\.ts/ });
    await user.click(screen.getByRole('radio', { name: 'working tree' }));
    await user.click(screen.getByRole('radio', { name: 'compare' }));
    expect(screen.getByLabelText('Base')).toHaveValue('island');
    await action('branches');
    await user.click(await screen.findByTitle('Compare with feature'));
    expect(screen.getByLabelText('Base')).toHaveValue('feature');
    expect(screen.getByLabelText('Compare')).toHaveValue('main');
    await action('swap-compare');
    expect(screen.getByLabelText('Base')).toHaveValue('main');
    await action('history');
    await action('compare');
    expect(useLayout.getState().tabs[repository.id].mode).toBe('compare');
    act(() => useTabs.getState().close(repository.id));
    expect(useLayout.getState().tabs[repository.id]).toBeUndefined();
    expect(useSelection.getState().compare[repository.id]).toBeUndefined();
  });
});
