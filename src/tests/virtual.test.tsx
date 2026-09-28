import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Profiler } from 'react';
import { QueryProvider } from '../providers/QueryProvider';
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { mockCommand, calls } from './harness';
import { workers } from './setup';
import { renders } from './renders';
import { settings, status, repository, gapped, gappedText } from './fixtures';
import {
  commit,
  setup,
  settled,
  shown,
  colored,
  renderStack,
  named,
  headers,
  scrollTo,
  blockOf,
} from './workbench';
describe('virtualized all changes pane', () => {
  function many(count: number, present = count) {
    const paths = named(count);
    mockCommand('commit_files', () =>
      Object.fromEntries(paths.map((path) => [path, 'M'])),
    );
    mockCommand('diff_stack', () => ({
      files: Object.fromEntries(
        paths.slice(0, present).map((path) => [path, { ...gapped, path }]),
      ),
      truncated: present < count,
    }));
    mockCommand('file_lines', () => gappedText);
    return paths;
  }
  it('mounts only the blocks near the viewport and reaches the last one by scrolling', async () => {
    setup();
    many(200);
    const pane = await renderStack();
    await waitFor(() => expect(headers(pane).length).toBeGreaterThan(0));
    expect(headers(pane).length).toBeLessThan(10);
    scrollTo(pane, 200 * 1000);
    expect(
      await within(pane).findByRole('button', { name: /file199\.ts/ }),
    ).toBeVisible();
    expect(headers(pane).length).toBeLessThan(10);
  });
  it('keeps collapse and gap expansion through unmounting and remounting', async () => {
    setup();
    many(30);
    const user = userEvent.setup();
    const pane = await renderStack();
    const first = await within(pane).findByRole('button', { name: /file000/ });
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    const second = blockOf(pane, /file001/);
    await user.click(await within(second).findByLabelText('Show all 13 lines'));
    await waitFor(() => expect(shown(second, 'line 40')).toBeGreaterThan(0));
    scrollTo(pane, 20 * 600);
    await waitFor(() =>
      expect(
        within(pane).queryByRole('button', { name: /file000/ }),
      ).toBeNull(),
    );
    expect(within(pane).queryByRole('button', { name: /file001/ })).toBeNull();
    scrollTo(pane, 0);
    expect(
      await within(pane).findByRole('button', { name: /file000/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    const again = blockOf(pane, /file001/);
    await waitFor(() => expect(shown(again, 'line 40')).toBeGreaterThan(0));
    expect(within(again).queryByLabelText('Show all 13 lines')).toBeNull();
  });
  it('issues no fallback read and no highlighting for blocks scrolled past quickly', async () => {
    setup();
    const paths = many(30, 3);
    const pane = await renderStack();
    await waitFor(() => expect(headers(pane).length).toBeGreaterThan(0));
    const mounted = new Set<string>();
    for (let step = 1; step <= 24; step++) {
      scrollTo(pane, step * 600);
      headers(pane).forEach((header) =>
        mounted.add(header.querySelector('[title]')!.getAttribute('title')!),
      );
    }
    await act(settled);
    const passed = paths.slice(5, 20);
    expect(passed.every((path) => mounted.has(path))).toBe(true);
    const read = calls.flatMap((call) =>
      call.command === 'diff' ? [(call.args as { path: string }).path] : [],
    );
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((path) => passed.includes(path))).toEqual([]);
    expect(workers.jobs.filter((job) => passed.includes(job.path))).toEqual([]);
  });
  it('re-renders only the block whose content changed size', async () => {
    setup();
    many(3);
    let commits = 0;
    render(
      <Profiler id="pane" onRender={() => (commits += 1)}>
        <QueryProvider>
          <AllChangesPane
            repo={repository.id}
            stack="commit"
            commit={{ path: '', source: 'commit', revision: commit.hash }}
            status={status}
            settings={settings}
            disabled={false}
          />
        </QueryProvider>
      </Profiler>,
    );
    const pane = await screen.findByRole('region', {
      name: 'All changes in commit',
    });
    await within(pane).findByRole('button', { name: /file000/ });
    const block = blockOf(pane, /file000/);
    const toggle = await within(block).findByLabelText('Show all 13 lines');
    await waitFor(() =>
      expect(colored(blockOf(pane, /file002/))).toBeGreaterThan(0),
    );
    renders.start();
    commits = 0;
    fireEvent.click(toggle);
    await waitFor(() => expect(shown(block, 'line 40')).toBeGreaterThan(0));
    await act(settled);
    expect(commits).toBeGreaterThan(0);
    expect(renders.of('AllChangesPane')).toBeGreaterThan(0);
    const blocks = (path: string) =>
      renders.of(
        'FileDiff',
        (props) =>
          (props as { selection: { path: string } }).selection.path === path,
      );
    expect(blocks('src/file000.ts')).toBeGreaterThan(0);
    expect(blocks('src/file001.ts')).toBe(0);
    expect(blocks('src/file002.ts')).toBe(0);
  });
});
