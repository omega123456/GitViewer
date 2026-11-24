import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { milliseconds } from 'date-fns';
import { expect, it, vi } from 'vitest';
import { Profiler } from 'react';
import { QueryProvider } from '../providers/QueryProvider';
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { callsFor, mockCommand } from './harness';
import { VIEWPORT_HEIGHT, workers } from './setup';
import { renders } from './renders';
import { gapped, gappedText, repository, settings, status } from './fixtures';
import {
  blockOf,
  colored,
  commit,
  headers,
  named,
  renderStack,
  scrollTo,
  setup,
  shown,
  waitForWorkersIdle,
} from './workbench';

const LARGE_FILE_COUNT = 200;
const VISIBLE_BLOCK_CAP = 10;
const ESTIMATED_BLOCK_HEIGHT = 1000;
const MEDIUM_FILE_COUNT = 30;
const SCROLL_JUMP_BLOCKS = 20;
const PRESENT_STACK_COUNT = 3;
const QUICK_SCROLL_STEPS = 24;
const SKIPPED_RANGE_START = 5;
const SKIPPED_RANGE_END = 20;
const SMALL_STACK_COUNT = 3;
const SETTLE_SECONDS = 0.25;

function mockManyFiles(fileCount: number, present = fileCount) {
  const paths = named(fileCount);
  mockCommand('commit_files', () => ({
    statuses: Object.fromEntries(paths.map((path) => [path, 'M'])),
    lines: {},
  }));
  mockCommand('diff_stack', () => ({
    files: Object.fromEntries(
      paths.slice(0, present).map((path) => [path, { ...gapped, path }]),
    ),
    truncated: present < fileCount,
  }));
  mockCommand('file_lines', () => gappedText);
  return paths;
}

function headerTitle(header: HTMLElement): string {
  const title = header.querySelector('[title]')?.getAttribute('title');
  if (!title) throw new Error('Missing header title attribute');
  return title;
}

function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value))
    return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function selectionPathOf(props: unknown): string | undefined {
  const path = fieldOf(fieldOf(fieldOf(props, 'entry'), 'selection'), 'path');
  return typeof path === 'string' ? path : undefined;
}

it('mounts only the blocks near the viewport and reaches the last one by scrolling', async () => {
  setup();
  mockManyFiles(LARGE_FILE_COUNT);
  const pane = await renderStack();
  await waitFor(() => expect(headers(pane).length).toBeGreaterThan(0));
  expect(headers(pane).length).toBeLessThan(VISIBLE_BLOCK_CAP);
  scrollTo(pane, LARGE_FILE_COUNT * ESTIMATED_BLOCK_HEIGHT);
  expect(
    await within(pane).findByRole('button', { name: /file199\.ts/ }),
  ).toBeVisible();
  expect(headers(pane).length).toBeLessThan(VISIBLE_BLOCK_CAP);
});

it('keeps collapse and gap expansion through unmounting and remounting', async () => {
  setup();
  mockManyFiles(MEDIUM_FILE_COUNT);
  const user = userEvent.setup();
  const pane = await renderStack();
  const first = await within(pane).findByRole('button', { name: /file000/ });
  await user.click(first);
  expect(first).toHaveAttribute('aria-expanded', 'false');
  const second = blockOf(pane, /file001/);
  await user.click(await within(second).findByLabelText('Show all 13 lines'));
  await waitFor(() => expect(shown(second, 'line 40')).toBeGreaterThan(0));
  scrollTo(pane, SCROLL_JUMP_BLOCKS * VIEWPORT_HEIGHT);
  await waitFor(() =>
    expect(within(pane).queryByRole('button', { name: /file000/ })).toBeNull(),
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setup();
  const paths = mockManyFiles(MEDIUM_FILE_COUNT, PRESENT_STACK_COUNT);
  const pane = await renderStack();
  await waitFor(() => expect(headers(pane).length).toBeGreaterThan(0));
  const mounted = new Set<string>();
  for (let step = 1; step <= QUICK_SCROLL_STEPS; step++) {
    scrollTo(pane, step * VIEWPORT_HEIGHT);
    headers(pane).forEach((header) => mounted.add(headerTitle(header)));
  }
  await act(async () => {
    vi.advanceTimersByTime(milliseconds({ seconds: SETTLE_SECONDS }));
  });
  await waitFor(() => expect(callsFor('diff').length).toBeGreaterThan(0));
  const passed = paths.slice(SKIPPED_RANGE_START, SKIPPED_RANGE_END);
  expect(passed.every((path) => mounted.has(path))).toBe(true);
  const read = callsFor('diff').map((args) => args.path);
  expect(read.filter((path) => passed.includes(path))).toEqual([]);
  expect(workers.jobs.filter((job) => passed.includes(job.path))).toEqual([]);
});

it('re-renders only the block whose content changed size', async () => {
  setup();
  mockManyFiles(SMALL_STACK_COUNT);
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
  for (const name of [/file000/, /file001/, /file002/])
    await waitFor(() =>
      expect(colored(blockOf(pane, name))).toBeGreaterThan(0),
    );
  await waitForWorkersIdle();
  renders.start();
  commits = 0;
  fireEvent.click(toggle);
  await waitFor(() => expect(shown(block, 'line 40')).toBeGreaterThan(0));
  await waitForWorkersIdle();
  expect(commits).toBeGreaterThan(0);
  expect(renders.of('AllChangesPane')).toBeGreaterThan(0);
  const blocks = (path: string) =>
    renders.of('FileDiff', (props) => selectionPathOf(props) === path);
  expect(blocks('src/file000.ts')).toBeGreaterThan(0);
  expect(blocks('src/file001.ts')).toBe(0);
  expect(blocks('src/file002.ts')).toBe(0);
});
