import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { selectionOf } from '../stores/selection';
import { fuzzyFilter } from '../lib/fuzzy';
import { calls, dialog, mockCommand } from './harness';
import { repository } from './fixtures';
import { assertElement, mountApp, runAction, setup } from './workbench';

vi.mock('../lib/fuzzy', { spy: true });

const OVERFLOW_SCROLL_WIDTH = 100;
const SIDEBAR_DRAG_X = 500;
const FILES_DRAG_Y = 300;
const MESSAGE_RESIZED_HEIGHT = 170;
const MESSAGE_DRAG_Y = 400;

async function openFilePalette() {
  setup();
  mockCommand('files', ({ ignored }) =>
    ignored
      ? ['README.md', 'src/app.ts', 'new.txt', 'dist/bundle.js']
      : ['README.md', 'src/app.ts', 'new.txt'],
  );
  mountApp();
  const message = await screen.findByLabelText('Commit message');
  fireEvent.keyDown(message, { key: 'F2' });
  const palette = await screen.findByRole('dialog', {
    name: 'Command palette',
  });
  return {
    palette: palette,
    input: within(palette).getByLabelText('Find file'),
  };
}

it('offers the palette and open command before a repository is open', async () => {
  setup();
  useTabs.getState().close(repository.id);
  mockCommand('repo_open', () => repository);
  dialog.path = repository.id;
  const user = userEvent.setup();
  mountApp();
  await screen.findByText('No repository open');
  fireEvent.keyDown(window, { key: 'p', metaKey: true, shiftKey: true });
  const palette = await screen.findByRole('dialog', {
    name: 'Command palette',
  });
  await user.click(
    within(palette).getByRole('button', { name: /Open repository/ }),
  );
  await screen.findByLabelText('Commit message');
  await runAction('close-repository');
  expect(await screen.findByText('No repository open')).toBeVisible();
});

it('finds files with F2, toggles ignored files, and shows overflow titles', async () => {
  const user = userEvent.setup();
  const { palette, input } = await openFilePalette();
  const readme = await within(palette).findByRole('button', {
    name: /README\.md/,
  });
  expect(readme).toBeVisible();
  fireEvent.mouseEnter(readme);
  expect(readme).not.toHaveAttribute('title', 'README.md');
  const overflow = vi
    .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
    .mockReturnValue(OVERFLOW_SCROLL_WIDTH);
  fireEvent.mouseEnter(readme);
  expect(readme).toHaveAttribute('title', 'README.md');
  overflow.mockRestore();
  expect(
    within(palette).queryByRole('button', { name: /bundle\.js/ }),
  ).not.toBeInTheDocument();
  await user.type(input, 'missing');
  expect(
    within(palette).getByText('Include ignored files to widen the search'),
  ).toBeVisible();
  await user.clear(input);
  await user.click(within(palette).getByLabelText('Include ignored files'));
  expect(
    await within(palette).findByRole('button', { name: /bundle\.js/ }),
  ).toBeVisible();
  await user.type(input, 'missing');
  expect(within(palette).getByText('No file matches “missing”')).toBeVisible();
  expect(
    within(palette).queryByText('Include ignored files to widen the search'),
  ).not.toBeInTheDocument();
});

it('filters files with F2 and opens the chosen one in the diff view', async () => {
  const user = userEvent.setup();
  const { palette, input } = await openFilePalette();
  await within(palette).findByRole('button', { name: /README\.md/ });
  await user.type(input, 'sapt');
  expect(within(palette).getAllByRole('button', { name: /\./ })).toHaveLength(
    1,
  );
  const marks = [...palette.querySelectorAll('mark')];
  expect(marks.map((mark) => mark.textContent)).toEqual(['ap', 't', 's']);
  const scored = vi.mocked(fuzzyFilter).mock.calls.length;
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.mouseEnter(within(palette).getByRole('button', { name: /app/ }));
  expect(fuzzyFilter).toHaveBeenCalledTimes(scored);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(useLayout.getState().tabs[repository.id]?.mode).toBe('working');
  expect(selectionOf(repository.id, 'working')).toEqual({
    path: 'src/app.ts',
    source: 'unstaged',
  });
});

it('navigates commands in the palette and switches back to files preserving ignored state', async () => {
  setup();
  mockCommand('files', () => ['README.md', 'src/app.ts']);
  const user = userEvent.setup();
  mountApp();
  await screen.findByLabelText('Commit message');
  fireEvent.keyDown(window, { key: 'F2' });
  const filePalette = await screen.findByRole('dialog', {
    name: 'Command palette',
  });
  await user.click(within(filePalette).getByLabelText('Include ignored files'));
  await user.keyboard('{Escape}');
  fireEvent.keyDown(window, { key: 'p', metaKey: true, shiftKey: true });
  const commands = await screen.findByRole('dialog', {
    name: 'Command palette',
  });
  const search = within(commands).getByLabelText('Find command');
  expect(search).toHaveValue('');
  await user.type(search, 'zzz');
  expect(within(commands).getByText('No command matches “zzz”')).toBeVisible();
  expect(
    within(commands).getByText('Press F2 to search files instead'),
  ).toBeVisible();
  await user.clear(search);
  const highlighted = () =>
    assertElement(commands.querySelector('[data-current]'));
  const first = highlighted();
  const scrolled = vi.mocked(HTMLElement.prototype.scrollIntoView);
  fireEvent.keyDown(search, { key: 'PageDown' });
  const second = highlighted();
  expect(second).not.toBe(first);
  expect(scrolled.mock.contexts.at(-1)).toBe(second);
  fireEvent.keyDown(search, { key: 'PageUp' });
  fireEvent.keyDown(search, { key: 'PageUp' });
  expect(highlighted()).toBe(first);
  expect(scrolled.mock.contexts.at(-1)).toBe(first);
  const scrolls = scrolled.mock.calls.length;
  fireEvent.mouseEnter(second);
  expect(highlighted()).toBe(second);
  expect(commands.querySelectorAll('[data-current]')).toHaveLength(1);
  expect(scrolled).toHaveBeenCalledTimes(scrolls);
  fireEvent.keyDown(search, { key: 'ArrowUp' });
  expect(highlighted()).toBe(first);
  expect(scrolled.mock.contexts.at(-1)).toBe(first);
  await user.click(
    within(commands).getByRole('button', { name: /Go to file/ }),
  );
  expect(
    await screen.findByRole('dialog', { name: 'Command palette' }),
  ).toBeVisible();
  expect(screen.getByLabelText('Find file')).toBeVisible();
  expect(screen.getByLabelText('Include ignored files')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('drags both splitters within their announced bounds and collapses trees', async () => {
  setup();
  const user = userEvent.setup();
  mountApp();
  const sidebar = await screen.findByLabelText('Resize sidebar');
  expect(fireEvent.pointerDown(sidebar)).toBe(false);
  expect(sidebar).toHaveFocus();
  fireEvent.pointerMove(sidebar, { clientX: SIDEBAR_DRAG_X });
  expect(sidebar).toHaveAttribute('aria-valuenow', String(SIDEBAR_DRAG_X));
  expect(screen.getByRole('button', { name: /^Files/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(
    screen.queryByLabelText('Resize files section'),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Files/ }));
  const sections = screen.getByLabelText('Resize files section');
  fireEvent.pointerDown(sections);
  fireEvent.pointerMove(sections, { clientY: FILES_DRAG_Y });
  expect(sections).toHaveAttribute('aria-valuenow', '50');
  const messageHandle = screen.getByLabelText('Resize commit message');
  fireEvent.keyDown(messageHandle, { key: 'ArrowDown' });
  expect(useLayout.getState().tabs[repository.id].commitMessageHeight).toBe(
    MESSAGE_RESIZED_HEIGHT,
  );
  fireEvent.pointerDown(messageHandle);
  fireEvent.pointerMove(messageHandle, { clientY: MESSAGE_DRAG_Y });
  expect(messageHandle).toHaveAttribute('aria-valuenow', '200');
  await user.click(screen.getByRole('button', { name: /^Files/ }));
  expect(screen.getByRole('button', { name: /^Files/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await runAction('new-branch');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  await runAction('new-branch');
  mockCommand('branch_create', () => null);
  mockCommand('branch_switch', () => null);
  await user.type(screen.getByLabelText('Name'), 'new{Enter}');
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'branch_switch',
      args: { repo: repository.id, name: 'new' },
    }),
  );
  await runAction('delete-branch');
  expect(await screen.findByLabelText('Filter branches')).toBeVisible();
});
