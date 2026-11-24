import {
  act,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { QueryProvider } from '../providers/QueryProvider';
import { useSelection } from '../stores/selection';
import { useDiffView } from '../stores/diff-view';
import { DiffPane } from '../components/diff/DiffPane';
import { useTokens } from '../components/diff/tokens';
import type { Diff } from '../lib/types';
import { emit, mockCommand } from './harness';
import { flushChannel, release, workers } from './setup';
import { diff, gapped, gappedText, repository, settings } from './fixtures';
import {
  assertElement,
  blockOf,
  colored,
  jobsFor,
  mountApp,
  renderFile,
  renderStack,
  rows,
  setup,
  shown,
  waitForWorkersIdle,
} from './workbench';

const OVERLONG_REPEAT = 2500;
const STREAM_LINE_COUNT = 1200;
const EXPECTED_CHUNKS = 3;
const MIN_REMAINING_CHUNKS = 2;
const TWO_SIDES = 2;
const RETOKENIZED_JOBS = 4;
const HUNK_ONE_COUNT = 4;
const HUNK_TWO_START = 8;
const HUNK_TWO_COUNT = 3;
const HUNK_TWO_CHANGED_LINE = 9;
const HUNK_TWO_END_LINE = 10;
const SECOND_LINE = 2;
const THIRD_LINE = 3;
const FOURTH_LINE = 4;

function diffLine(
  kind: 'context' | 'add' | 'remove',
  lineNumber: number,
  content: string,
): Diff['hunks'][number]['lines'][number] {
  return {
    kind: kind,
    content: content,
    old: kind === 'add' ? null : lineNumber,
    new: kind === 'remove' ? null : lineNumber,
    noNewline: false,
    marks: [],
  };
}

function mockSplitTemplateDiff() {
  const shared = [
    'const text = `',
    'first',
    'second',
    'third',
    '`;',
    'const filler = 7;',
    'const filler2 = 8;',
  ];
  const before = ['const a = 0;', ...shared, 'const old = 9;', 'end();'];
  const after = ['const a = 1;', ...shared, 'const fresh = 9;', 'end();'];
  const contextLineNumbers = [SECOND_LINE, THIRD_LINE, FOURTH_LINE];
  mockCommand('diff', () => ({
    ...diff,
    patches: ['patch', 'patch'],
    hunks: [
      {
        header: '@@ -1,4 +1,4 @@',
        oldStart: 1,
        oldCount: HUNK_ONE_COUNT,
        newStart: 1,
        newCount: HUNK_ONE_COUNT,
        lines: [
          diffLine('remove', 1, before[0]),
          diffLine('add', 1, after[0]),
          ...contextLineNumbers.map((lineNumber) =>
            diffLine('context', lineNumber, after[lineNumber - 1]),
          ),
        ],
      },
      {
        header: '@@ -8,3 +8,3 @@',
        oldStart: HUNK_TWO_START,
        oldCount: HUNK_TWO_COUNT,
        newStart: HUNK_TWO_START,
        newCount: HUNK_TWO_COUNT,
        lines: [
          diffLine('context', HUNK_TWO_START, after[HUNK_TWO_START - 1]),
          diffLine('remove', HUNK_TWO_CHANGED_LINE, before[HUNK_TWO_START]),
          diffLine('add', HUNK_TWO_CHANGED_LINE, after[HUNK_TWO_START]),
          diffLine('context', HUNK_TWO_END_LINE, after[HUNK_TWO_CHANGED_LINE]),
        ],
      },
    ],
  }));
  mockCommand(
    'file_lines',
    (args) => `${(args.old ? before : after).join('\n')}\n`,
  );
}

it('streams a long file in chunks, colours the top first, and leaves an overlong line plain', async () => {
  setup();
  useDiffView.getState().setMode('unified');
  const long = `const text = "${'a'.repeat(OVERLONG_REPEAT)}";`;
  mockCommand('diff', () =>
    rows(STREAM_LINE_COUNT, (index) =>
      index === 1 ? long : `const row${index} = ${index};`,
    ),
  );
  workers.held = true;
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  await waitFor(() => expect(workers.queued).toHaveLength(EXPECTED_CHUNKS));
  expect(workers.jobs.map((job) => job.lines.length)).toEqual([
    STREAM_LINE_COUNT,
  ]);
  const pane = screen.getByRole('region', { name: 'Diff viewer' });
  expect(colored(pane)).toBe(0);
  while (colored(pane) === 0 && workers.queued.length > 0) {
    await act(async () => {
      release(1);
      await flushChannel();
    });
  }
  expect(colored(pane)).toBeGreaterThan(0);
  expect(workers.queued.length).toBeGreaterThanOrEqual(MIN_REMAINING_CHUNKS);
  const capped = assertElement(
    [...pane.querySelectorAll('code')].find((code) =>
      code.textContent?.includes('aaaa'),
    ),
  );
  const spans = capped.querySelectorAll<HTMLElement>('.text-syntax');
  expect(spans).toHaveLength(1);
  expect(spans[0].style.getPropertyValue('--syntax-color')).toBe('inherit');
  await act(async () => release());
  await waitForWorkersIdle();
});

it('falls back to plain tokens without an error surface when the worker fails', async () => {
  setup();
  workers.failing = true;
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  const pane = await screen.findByRole('region', { name: 'Diff viewer' });
  await waitFor(() => expect(workers.jobs).toHaveLength(TWO_SIDES));
  await waitForWorkersIdle();
  expect(shown(pane, 'new value')).toBe(1);
  expect(colored(pane)).toBe(0);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('cancels an unfinished job when the selection changes and highlights stacked files side by side', async () => {
  setup();
  workers.held = true;
  const view = renderFile({ path: 'src/app.ts', source: 'unstaged' });
  await waitFor(() => expect(workers.jobs).toHaveLength(TWO_SIDES));
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

it('highlights each side against its full file so a hidden gap cannot leave later hunks inside a string', async () => {
  setup();
  useDiffView.getState().setMode('unified');
  mockSplitTemplateDiff();
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  const pane = await screen.findByRole('region', { name: 'Diff viewer' });
  const keywordColor = (text: string) => {
    const code = [...pane.querySelectorAll('code')].find((node) =>
      node.textContent?.includes(text),
    );
    return [...(code?.querySelectorAll<HTMLElement>('.text-syntax') ?? [])]
      .find((span) => span.textContent === 'const')
      ?.style.getPropertyValue('--syntax-color');
  };
  await waitFor(() => expect(keywordColor('const a = 1;')).toMatch(/^#/));
  await waitForWorkersIdle();
  expect(keywordColor('const fresh = 9;')).toBe(keywordColor('const a = 1;'));
  expect(keywordColor('const old = 9;')).toBe(keywordColor('const a = 1;'));
});

it('falls back to the diff lines when the file text no longer matches them', async () => {
  setup();
  useDiffView.getState().setMode('unified');
  mockCommand('file_lines', () => 'unrelated\n');
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  const pane = await screen.findByRole('region', { name: 'Diff viewer' });
  await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
  await waitForWorkersIdle();
  expect(shown(pane, 'new value')).toBe(1);
  expect(shown(pane, 'unrelated')).toBe(0);
});

it('hands every remount the same merged tokens without copying them again', async () => {
  setup();
  const selection = { path: 'src/app.ts', source: 'unstaged' as const };
  const useAppTokens = () =>
    useTokens({ repo: repository.id, selection: selection, data: diff });
  const first = renderHook(useAppTokens, { wrapper: QueryProvider });
  await waitFor(() =>
    expect(Object.keys(first.result.current).length).toBeGreaterThan(0),
  );
  await waitForWorkersIdle();
  const finished = first.result.current;
  first.unmount();
  const again = renderHook(useAppTokens, { wrapper: QueryProvider });
  const twice = renderHook(useAppTokens, { wrapper: QueryProvider });
  expect(again.result.current).toBe(finished);
  expect(twice.result.current).toBe(finished);
});

it('reuses finished tokens across a file tab switch, with the full file shown, and retokenizes on a theme change', async () => {
  setup();
  mockCommand('diff', (args) => (args.path === 'src/app.ts' ? gapped : diff));
  mockCommand('file_lines', () => gappedText);
  const user = userEvent.setup();
  mountApp();
  await screen.findByRole('button', { name: 'All changes' });
  act(() =>
    useSelection
      .getState()
      .select(repository.id, { path: 'src/app.ts', source: 'unstaged' }),
  );
  const pane = await screen.findByRole('region', { name: 'Diff viewer' });
  await user.click(await screen.findByTitle('Show full file'));
  await screen.findByTitle('Collapse to changes');
  await waitFor(() => expect(jobsFor('src/app.ts')).toBe(TWO_SIDES));
  await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
  await waitForWorkersIdle();
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
  await waitForWorkersIdle();
  expect(jobsFor('src/app.ts')).toBe(TWO_SIDES);
  mockCommand('settings_get', () => ({ ...settings, theme: 'dark' }));
  await act(async () => emit('settings://changed', null));
  await waitFor(() => expect(jobsFor('src/app.ts')).toBe(RETOKENIZED_JOBS));
  expect(workers.jobs.slice(-TWO_SIDES).every((job) => job.dark)).toBe(true);
});
