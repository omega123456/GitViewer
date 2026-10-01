import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Profiler } from 'react';
import App from '../App';
import { Providers } from '../providers';
import { QueryProvider } from '../providers/QueryProvider';
import { useSelection } from '../stores/selection';
import { useDiffView } from '../stores/diff-view';
import { useTheme } from '../stores/theme';
import { DiffPane } from '../components/diff/DiffPane';
import { useTokens } from '../components/diff/tokens';
import { mockCommand, calls } from './harness';
import { release, workers } from './setup';
import { renders } from './renders';
import {
  settings,
  status,
  repository,
  diff,
  gapped,
  gappedText,
} from './fixtures';
import {
  setup,
  mount,
  settled,
  shown,
  colored,
  renderStack,
  renderFile,
  action,
  rows,
  blockOf,
  jobsFor,
} from './workbench';
describe('highlighting in a worker', () => {
  it('streams a long file in chunks, colours the top first, and leaves an overlong line plain', async () => {
    setup();
    useDiffView.getState().setMode('unified');
    const long = `const text = "${'a'.repeat(2500)}";`;
    mockCommand('diff', () =>
      rows(1200, (index) =>
        index === 1 ? long : `const row${index} = ${index};`,
      ),
    );
    workers.held = true;
    renderFile({ path: 'src/app.ts', source: 'unstaged' });
    await waitFor(() => expect(workers.queued).toHaveLength(6));
    expect(workers.jobs.map((job) => job.lines.length)).toEqual([1200, 1200]);
    const pane = screen.getByRole('region', { name: 'Diff viewer' });
    expect(colored(pane)).toBe(0);
    while (!colored(pane) && workers.queued.length)
      await act(async () => {
        release(1);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    expect(colored(pane)).toBeGreaterThan(0);
    expect(workers.queued.length).toBeGreaterThanOrEqual(3);
    const capped = [...pane.querySelectorAll('code')].find((code) =>
      code.textContent?.includes('aaaa'),
    )!;
    const spans = capped.querySelectorAll<HTMLElement>('.text-syntax');
    expect(spans).toHaveLength(1);
    expect(spans[0].style.getPropertyValue('--syntax-color')).toBe('inherit');
    await act(async () => release());
  });
  it('falls back to plain tokens without an error surface when the worker fails', async () => {
    setup();
    workers.failing = true;
    renderFile({ path: 'src/app.ts', source: 'unstaged' });
    const pane = await screen.findByRole('region', { name: 'Diff viewer' });
    await waitFor(() => expect(workers.jobs).toHaveLength(2));
    await act(settled);
    expect(shown(pane, 'new value')).toBe(1);
    expect(colored(pane)).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('cancels an unfinished job when the selection changes and highlights stacked files side by side', async () => {
    setup();
    workers.held = true;
    const view = renderFile({ path: 'src/app.ts', source: 'unstaged' });
    await waitFor(() => expect(workers.jobs).toHaveLength(2));
    const first = workers.jobs.map((job) => job.id);
    view.rerender(
      <QueryProvider>
        <DiffPane
          repo={repository.id}
          selection={{ path: 'new.txt', source: 'file' }}
          settings={settings}
          disabled={false}
        />
      </QueryProvider>,
    );
    await waitFor(() => expect(workers.cancels).toEqual(first));
    workers.held = false;
    await act(async () => release());
    view.unmount();
    mockCommand('commit_files', () => ({
      statuses: { 'src/app.ts': 'M', 'lib.ts': 'M' },
      lines: {},
    }));
    mockCommand('diff_stack', () => ({
      files: { 'src/app.ts': diff, 'lib.ts': { ...diff, path: 'lib.ts' } },
      truncated: false,
    }));
    const pane = await renderStack();
    await waitFor(() => {
      expect(colored(blockOf(pane, /app\.ts/))).toBeGreaterThan(0);
      expect(colored(blockOf(pane, /lib\.ts/))).toBeGreaterThan(0);
    });
  });
  it('hands every remount the same merged tokens without copying them again', async () => {
    const first = renderHook(() => useTokens(diff, 'src/app.ts'));
    await waitFor(() =>
      expect(Object.keys(first.result.current).length).toBeGreaterThan(0),
    );
    await act(settled);
    const finished = first.result.current;
    first.unmount();
    const again = renderHook(() => useTokens(diff, 'src/app.ts'));
    const twice = renderHook(() => useTokens(diff, 'src/app.ts'));
    expect(again.result.current).toBe(finished);
    expect(twice.result.current).toBe(finished);
  });
  it('reuses finished tokens across a file tab switch, with the full file shown, and retokenizes on a theme change', async () => {
    setup();
    mockCommand('diff', (args) => (args.path === 'src/app.ts' ? gapped : diff));
    mockCommand('file_lines', () => gappedText);
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'All changes' });
    act(() =>
      useSelection
        .getState()
        .select(repository.id, { path: 'src/app.ts', source: 'unstaged' }),
    );
    const pane = await screen.findByRole('region', { name: 'Diff viewer' });
    await user.click(await screen.findByTitle('Show full file'));
    await screen.findByTitle('Collapse to changes');
    await waitFor(() => expect(jobsFor('src/app.ts')).toBe(3));
    await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
    await act(settled);
    act(() =>
      useSelection
        .getState()
        .select(repository.id, { path: 'new.txt', source: 'file' }),
    );
    await waitFor(() => expect(jobsFor('new.txt')).toBeGreaterThan(0));
    const strip = screen.getByRole('tablist', { name: 'Open files' });
    await user.click(within(strip).getByRole('tab', { name: /app\.ts/ }));
    const back = await screen.findByRole('region', { name: 'Diff viewer' });
    expect(colored(back)).toBeGreaterThan(0);
    await user.click(await screen.findByTitle('Show full file'));
    await screen.findByTitle('Collapse to changes');
    await act(settled);
    expect(jobsFor('src/app.ts')).toBe(3);
    act(() => useTheme.getState().setPreference('dark'));
    await waitFor(() => expect(jobsFor('src/app.ts')).toBe(5));
    expect(workers.jobs.slice(-2).every((job) => job.dark)).toBe(true);
  });
});
describe('render isolation', () => {
  const crowded = {
    ...status,
    entries: [
      ...status.entries,
      ...Array.from({ length: 60 }, (_, index) => ({
        kind: 'ordinary' as const,
        path: `src/file${index}.ts`,
        index: '.',
        worktree: 'M',
      })),
    ],
  };
  const children = [
    'ChangesSection',
    'FilesSection',
    'StashSection',
    'CommitList',
    'DiffPane',
    'SelectedDiff',
  ];
  async function shell() {
    setup();
    mockCommand('status', () => crowded);
    let commits = 0;
    render(
      <Profiler id="shell" onRender={() => (commits += 1)}>
        <Providers>
          <App />
        </Providers>
      </Profiler>,
    );
    await screen.findByRole('button', { name: 'All changes' });
    act(() =>
      useSelection
        .getState()
        .select(repository.id, { path: 'src/app.ts', source: 'unstaged' }),
    );
    const pane = await screen.findByRole('region', { name: 'Diff viewer' });
    await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
    await act(settled);
    renders.start();
    commits = 0;
    return () => commits;
  }
  it('re-renders only the commit box while typing a message', async () => {
    const user = userEvent.setup();
    const commits = await shell();
    await user.type(screen.getByLabelText('Commit message'), 'hello');
    expect(commits()).toBeGreaterThanOrEqual(5);
    expect(renders.of('CommitFooter')).toBeGreaterThanOrEqual(5);
    children.forEach((name) => expect(renders.of(name), name).toBe(0));
    expect(renders.of('RepositoryView')).toBe(1);
  });
  it('re-renders none of the heavy children while the sidebar divider moves', async () => {
    const commits = await shell();
    const divider = screen.getByLabelText('Resize sidebar');
    fireEvent.pointerDown(divider);
    fireEvent.pointerMove(divider, { clientX: 420 });
    fireEvent.pointerMove(divider, { clientX: 460 });
    expect(divider).toHaveAttribute('aria-valuenow', '460');
    expect(commits()).toBeGreaterThanOrEqual(2);
    expect(renders.of('RepositoryView')).toBe(2);
    children.forEach((name) => expect(renders.of(name), name).toBe(0));
  });
  it('commits and moves between files with the text typed after the last view render', async () => {
    setup();
    mockCommand('commit', () => 'b'.repeat(40));
    const user = userEvent.setup();
    mount();
    const box = await screen.findByLabelText('Commit message');
    const control = () =>
      screen.getByRole('button', { name: /^Commit .*main$/ });
    expect(control()).toBeDisabled();
    await user.type(box, '   ');
    expect(control()).toBeDisabled();
    await user.type(box, 'a');
    expect(control()).toBeEnabled();
    renders.start();
    await user.type(box, 'bc');
    expect(renders.of('RepositoryView')).toBe(0);
    await action('commit');
    expect(calls).toContainEqual({
      command: 'commit',
      args: { repo: repository.id, message: '   abc' },
    });
    await user.type(screen.getByPlaceholderText('Filter files…'), 'new');
    await action('next-file');
    expect(useSelection.getState().working[repository.id]?.path).toBe(
      'new.txt',
    );
  });
});
