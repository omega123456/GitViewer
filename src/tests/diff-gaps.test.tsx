import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useSelection } from '../stores/selection';
import { useDiffView } from '../stores/diff-view';
import { DEFAULT_MAX_FILE_TABS } from '../lib/settings';
import { calls, callsFor, dialog, mockCommand } from './harness';
import { diff, gapped, gappedText, repository } from './fixtures';
import {
  commit,
  count,
  mountApp,
  renderFile,
  renderStack,
  runAction,
  setup,
  shown,
} from './workbench';

const TWO_SIDES = 2;
const THREE_GAPS = 3;
const TWO_FILES = 2;
const TWO_HUNK_ACTIONS = 2;
const THREE_HUNK_ACTIONS = 3;

function setupGaps(text: string | null = gappedText) {
  setup();
  mockCommand('diff', () => gapped);
  mockCommand('file_lines', () => text);
}

function activeSelection() {
  const current = getSelection();
  if (!current) throw new Error('Expected browser Selection');
  return current;
}

it('labels every gap from the hunk headers until a gap is opened', async () => {
  setupGaps();
  const pane = renderFile({ path: 'src/app.ts', source: 'unstaged' });
  expect(await screen.findByText('26 hidden lines above')).toBeVisible();
  expect(screen.getByText('13 hidden lines')).toBeVisible();
  expect(screen.getByText('Rest of file hidden')).toBeVisible();
  expect(
    screen.getByLabelText('Show 20 more lines above hunk 1'),
  ).toBeVisible();
  expect(screen.queryByLabelText('Show 20 more lines below hunk 0')).toBeNull();
  expect(screen.getByLabelText('Show all 13 lines')).toBeVisible();
  expect(screen.queryByLabelText('Show 20 more lines above hunk 2')).toBeNull();
  await waitFor(() => expect(count('file_lines')).toBe(TWO_SIDES));
  expect(screen.getByText('Rest of file hidden')).toBeVisible();
  pane.unmount();
});

it('reveals twenty lines per step and fetches the file text once', async () => {
  setupGaps();
  const user = userEvent.setup();
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  await user.click(
    await screen.findByLabelText('Show 20 more lines below hunk 2'),
  );
  await waitFor(() =>
    expect(shown(document.body, 'line 54')).toBeGreaterThan(0),
  );
  expect(shown(document.body, 'line 73')).toBeGreaterThan(0);
  await user.click(screen.getByLabelText('Show 20 more lines above hunk 1'));
  expect(await screen.findByText('6 hidden lines above')).toBeVisible();
  expect(shown(document.body, 'line 7')).toBeGreaterThan(0);
  expect(screen.queryByLabelText('Show 20 more lines above hunk 1')).toBeNull();
  expect(callsFor('file_lines')).toEqual([
    { repo: repository.id, path: 'src/app.ts', source: 'unstaged', old: true },
    { repo: repository.id, path: 'src/app.ts', source: 'unstaged' },
  ]);
});

it('closes a gap with show all and moves focus to its hunk header', async () => {
  setupGaps();
  const user = userEvent.setup();
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  await user.click(await screen.findByLabelText('Show all remaining lines'));
  await waitFor(() =>
    expect(screen.queryByText('47 hidden lines below')).toBeNull(),
  );
  expect(screen.queryByText('Rest of file hidden')).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute('data-hunk', '1'),
  );
});

it('toggles the full file from the toolbar and the palette', async () => {
  setupGaps();
  const user = userEvent.setup();
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  await user.click(await screen.findByTitle('Show full file'));
  expect(await screen.findByTitle('Collapse to changes')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.queryByText('26 hidden lines above')).toBeNull();
  await runAction('context');
  expect(await screen.findByText('26 hidden lines above')).toBeVisible();
  expect(screen.getByTitle('Show full file')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

it('explains a file too large to expand', async () => {
  setupGaps(null);
  const user = userEvent.setup();
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  await user.click(await screen.findByLabelText('Show all 13 lines'));
  expect(await screen.findAllByText('File too large to expand')).toHaveLength(
    THREE_GAPS,
  );
  expect(screen.queryByText('Show all')).toBeNull();
});

it('spans split columns with one labelled row', async () => {
  setupGaps();
  useDiffView.getState().setMode('split');
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  expect(await screen.findAllByText('13 hidden lines')).toHaveLength(1);
  expect(screen.getByLabelText('Previous version')).toContainElement(
    screen.getByText('13 hidden lines'),
  );
});

it('keeps a text selection in the left column instead of focusing the scroller', async () => {
  setup();
  useDiffView.getState().setMode('split');
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  await screen.findByTitle('Stage hunk');
  const previous = screen.getByLabelText('Previous version');
  const selection = activeSelection();
  selection.selectAllChildren(previous);
  fireEvent.pointerUp(previous);
  expect(document.body).toHaveFocus();
  expect(selection.toString()).not.toBe('');
  selection.removeAllRanges();
  fireEvent.pointerUp(previous);
  expect(document.body).not.toHaveFocus();
});

it('shows no toggle for a diff without gaps', async () => {
  setup();
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  await screen.findByTitle('Stage hunk');
  expect(screen.queryByTitle('Show full file')).toBeNull();
});

it('expands one stacked file without touching its neighbours', async () => {
  setupGaps();
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M', 'lib.ts': 'M' },
    lines: {},
  }));
  mockCommand('diff_stack', () => ({
    files: { 'src/app.ts': gapped, 'lib.ts': gapped },
    truncated: false,
  }));
  const user = userEvent.setup();
  const pane = await renderStack();
  const toggles = await within(pane).findAllByTitle('Show full file');
  expect(toggles).toHaveLength(TWO_FILES);
  await user.click(toggles[0]);
  expect(await within(pane).findByTitle('Collapse to changes')).toBeVisible();
  expect(within(pane).getAllByTitle('Show full file')).toHaveLength(1);
  expect(calls).toContainEqual({
    command: 'file_lines',
    args: {
      repo: repository.id,
      path: 'src/app.ts',
      source: 'commit',
      revision: commit.hash,
    },
  });
});

it('emphasizes the changed words given as range marks', async () => {
  setup();
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  const emphasized = async (tint: string) => {
    await screen.findAllByText('old');
    return [...document.querySelectorAll(`.${tint}`)].map(
      (span) => span.textContent,
    );
  };
  await waitFor(async () =>
    expect(await emphasized('bg-remove-word')).toEqual(['old']),
  );
  expect(await emphasized('bg-add-word')).toEqual(['new']);
  const code = [...document.querySelectorAll('code')].find((node) =>
    node.textContent?.includes('old value'),
  );
  expect(code?.textContent).toContain('old value');
});

it('copies the file path from the diff header', async () => {
  setup();
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'src/app.ts', source: 'unstaged' },
      DEFAULT_MAX_FILE_TABS,
    );
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByLabelText('Copy file path'));
  expect(await screen.findByLabelText('Copied')).toBeVisible();
  expect(calls).toContainEqual({
    command: 'clipboard_write',
    args: { text: 'src/app.ts' },
  });
});

it('keeps the copy label when the clipboard write fails', async () => {
  setup();
  mockCommand('clipboard_write', () => {
    throw { category: 'unexpected', message: 'Clipboard write failed' };
  });
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'src/app.ts', source: 'unstaged' },
      DEFAULT_MAX_FILE_TABS,
    );
  const user = userEvent.setup();
  mountApp();
  await user.click(await screen.findByLabelText('Copy file path'));
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'clipboard_write',
      args: { text: 'src/app.ts' },
    }),
  );
  expect(screen.getByLabelText('Copy file path')).toBeVisible();
  expect(screen.queryByLabelText('Copied')).not.toBeInTheDocument();
});

it('uses the registry for hunk actions, view controls, and system opening', async () => {
  setup();
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'src/app.ts', source: 'unstaged' },
      DEFAULT_MAX_FILE_TABS,
    );
  mockCommand('hunk_action', () => null);
  mockCommand('system_open', () => null);
  mountApp();
  await screen.findByTitle('Stage hunk');
  for (const id of [
    'next-hunk',
    'previous-hunk',
    'stage-hunk',
    'discard-hunk',
    'open-file',
    'wrap',
    'whitespace',
    'diff-mode',
  ])
    await runAction(id);
  expect(count('hunk_action')).toBe(TWO_HUNK_ACTIONS);
  await screen.findByTitle('Stage hunk');
  expect(screen.getByTitle('Stage hunk')).toBeEnabled();
  await runAction('stage-hunk');
  expect(calls.at(-1)?.command).toBe('hunk_action');
  expect(calls.at(-1)?.args).not.toHaveProperty('context');
  dialog.approved = false;
  await runAction('discard-hunk');
  expect(count('hunk_action')).toBe(THREE_HUNK_ACTIONS);
});

it('shows a failed region in place and retries it', async () => {
  let failing = true;
  mockCommand('diff', () => {
    if (failing)
      throw {
        category: 'refused',
        message: "fatal: path 'src/app.ts' does not exist in 'HEAD~3'",
      };
    return diff;
  });
  const user = userEvent.setup();
  renderFile({ path: 'src/app.ts', source: 'unstaged' });
  expect(await screen.findByText('Could not load this file')).toBeVisible();
  expect(
    screen.getByText("Path 'src/app.ts' does not exist in 'HEAD~3'"),
  ).toBeVisible();
  failing = false;
  await user.click(screen.getByRole('button', { name: /Retry/ }));
  await waitFor(() =>
    expect(
      screen.queryByText('Could not load this file'),
    ).not.toBeInTheDocument(),
  );
});
