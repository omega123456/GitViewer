import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { useSelection, selectionOf } from '../stores/selection';
import { useDiffView } from '../stores/diff-view';
import { DEFAULT_MAX_FILE_TABS } from '../lib/settings';
import { mockCommand } from './harness';
import { workers } from './setup';
import { repository } from './fixtures';
import {
  blameLines,
  markdownDiff,
  mountApp,
  renderFile,
  rows,
  runAction,
  setup,
} from './workbench';

const NEEDLE_LINE_COUNT = 200;
const NEEDLE_STRIDE = 50;
const SECOND_BLAME_LINE = 2;

function needleDiff() {
  return rows(NEEDLE_LINE_COUNT, (index) =>
    index % NEEDLE_STRIDE === 0
      ? `needle ${index}`
      : `const row${index} = ${index};`,
  );
}

function findCounter() {
  return within(screen.getByRole('search')).getByRole('status');
}

function currentFindMatches() {
  return [...document.querySelectorAll('.bg-find-current')].map(
    (span) => span.textContent,
  );
}

it('shows the new Markdown version as prose, drops the toolbar, and strips scripts', async () => {
  setup();
  mockCommand('diff', () =>
    markdownDiff([
      { kind: 'context', content: '# Release notes' },
      { kind: 'remove', content: 'Dropped sentence.' },
      { kind: 'add', content: 'Kept sentence.' },
      { kind: 'add', content: '' },
      { kind: 'add', content: '<script>globalThis.hacked = true;</script>' },
      { kind: 'add', content: '' },
      { kind: 'add', content: '```bash' },
      { kind: 'add', content: 'pnpm install' },
      { kind: 'add', content: '```' },
    ]),
  );
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'README.md', source: 'unstaged' },
      DEFAULT_MAX_FILE_TABS,
    );
  mountApp();
  expect(await screen.findByRole('tab', { name: 'split' })).toBeVisible();
  await runAction('rendered');
  expect(
    await screen.findByRole('heading', { name: 'Release notes' }),
  ).toBeVisible();
  expect(screen.getByText('Kept sentence.')).toBeVisible();
  expect(screen.queryByText('Dropped sentence.')).toBeNull();
  expect(screen.queryByRole('tab', { name: 'split' })).toBeNull();
  const article = screen.getByRole('article');
  expect(article.querySelector('script')).toBeNull();
  expect(article.querySelector('code')).toHaveTextContent('pnpm install');
  await waitFor(() =>
    expect(article.querySelector('code span[style]')).not.toBeNull(),
  );
  expect(workers.jobs.map((job) => job.path)).toContain('fence.bash');
  await runAction('rendered');
  expect(await screen.findByRole('tab', { name: 'split' })).toBeVisible();
});

it('renders the last version of a deleted Markdown file behind a notice', async () => {
  setup();
  mockCommand('diff', () =>
    markdownDiff([{ kind: 'remove', content: '# Removed doc' }]),
  );
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'README.md', source: 'unstaged' },
      DEFAULT_MAX_FILE_TABS,
    );
  mountApp();
  expect(await screen.findByRole('button', { name: /Rendered/ })).toBeVisible();
  await runAction('rendered');
  expect(await screen.findByText(/This file was deleted/)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Removed doc' })).toBeVisible();
});

it('offers Rendered only for Markdown and keeps it exclusive with blame', async () => {
  setup();
  mockCommand('blame', () => blameLines);
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'src/app.ts', source: 'unstaged' },
      DEFAULT_MAX_FILE_TABS,
    );
  mountApp();
  expect(await screen.findByRole('button', { name: /Blame/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Rendered/ })).toBeNull();
  mockCommand('diff', () => markdownDiff([{ kind: 'add', content: '# Doc' }]));
  await act(async () => {
    useSelection
      .getState()
      .select(
        repository.id,
        { path: 'README.md', source: 'unstaged', blame: true },
        DEFAULT_MAX_FILE_TABS,
      );
  });
  await runAction('rendered');
  const selected = selectionOf(repository.id, 'working');
  expect(selected?.rendered).toBe(true);
  expect(selected?.blame).toBe(false);
  expect(await screen.findByRole('button', { name: /Source/ })).toBeVisible();
  await runAction('blame');
  expect(selectionOf(repository.id, 'working')?.rendered).toBe(false);
});

it('opens find with the shortcut, cycles matches with wrap-around, and closes with Escape', async () => {
  setup();
  useDiffView.getState().setMode('unified');
  mockCommand('diff', needleDiff);
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'src/app.ts', source: 'unstaged' },
      DEFAULT_MAX_FILE_TABS,
    );
  const user = userEvent.setup();
  mountApp();
  const surface = await screen.findByRole('region', { name: 'Diff content' });
  await within(surface).findByText(/needle 0/);
  fireEvent.keyDown(window, { key: 'f', metaKey: true });
  const input = await screen.findByRole('textbox', { name: 'Find in file' });
  expect(input).toHaveFocus();
  const scroll = vi.mocked(HTMLElement.prototype.scrollTo);
  scroll.mockClear();
  await user.type(input, 'NEEDLE');
  expect(findCounter()).toHaveTextContent('1 of 4');
  expect(currentFindMatches()).toEqual(['needle']);
  expect(scroll).toHaveBeenCalled();
  scroll.mockClear();
  await user.keyboard('{Enter}');
  expect(findCounter()).toHaveTextContent('2 of 4');
  expect(scroll).toHaveBeenCalled();
  await user.keyboard('{Shift>}{Enter}{Enter}{/Shift}');
  expect(findCounter()).toHaveTextContent('4 of 4');
  await user.click(screen.getByRole('button', { name: 'Next match' }));
  expect(findCounter()).toHaveTextContent('1 of 4');
  await user.click(screen.getByRole('button', { name: 'Previous match' }));
  expect(findCounter()).toHaveTextContent('4 of 4');
  await user.click(surface);
  fireEvent.keyDown(window, { key: 'F3' });
  expect(findCounter()).toHaveTextContent('1 of 4');
  fireEvent.keyDown(input, { key: 'F3', shiftKey: true });
  expect(findCounter()).toHaveTextContent('4 of 4');
  expect(screen.getByRole('button', { name: 'Next match' })).toHaveAttribute(
    'title',
    'Next match (F3)',
  );
  expect(
    screen.getByRole('button', { name: 'Previous match' }),
  ).toHaveAttribute('title', 'Previous match (⇧+F3)');
  await user.click(surface);
  fireEvent.keyDown(window, { key: 'f', metaKey: true });
  expect(input).toHaveFocus();
  await user.clear(input);
  await user.type(input, 'a.b(');
  expect(findCounter()).toHaveTextContent('No results');
  expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('search')).toBeNull();
  expect(currentFindMatches()).toEqual([]);
  expect(surface).toHaveFocus();
});

it('searches the blame lines and closes from its button', async () => {
  setup();
  mockCommand('blame', () => [
    ...blameLines,
    {
      ...blameLines[0],
      line: SECOND_BLAME_LINE,
      content: 'second first',
      block: false,
    },
  ]);
  const user = userEvent.setup();
  renderFile({ path: 'src/app.ts', source: 'unstaged', blame: true });
  const lines = await screen.findByLabelText('Blame lines');
  await within(lines).findByText('first');
  await runAction('find');
  await user.type(
    screen.getByRole('textbox', { name: 'Find in file' }),
    'first',
  );
  expect(findCounter()).toHaveTextContent('1 of 2');
  expect(currentFindMatches()).toEqual(['first']);
  await user.keyboard('{Enter}');
  expect(findCounter()).toHaveTextContent('2 of 2');
  expect(
    [...lines.querySelectorAll('.bg-find')].map((span) => span.textContent),
  ).toEqual(['first']);
  await user.click(screen.getByRole('button', { name: 'Close find' }));
  expect(screen.queryByRole('search')).toBeNull();
});
