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
import { useDiffView } from '../stores/diff-view';
import { DiffPane } from '../components/diff/DiffPane';
import { ImageDiff } from '../components/image/ImageDiff';
import { absolutePath } from '../components/shared/FileMenu';
import { fuzzyFilter } from '../lib/fuzzy';
import { mockCommand, dialog, calls, emit } from './harness';
import { workers } from './setup';
import { settings, repository, diff, gapped, gappedText } from './fixtures';
import {
  commit,
  setup,
  mount,
  count,
  shown,
  renderStack,
  renderFile,
  action,
  markdownDiff,
  blameLines,
  rows,
} from './workbench';
vi.mock('../lib/fuzzy', { spy: true });
describe('file context menu', () => {
  it('copies the name and full path and opens a changed file', async () => {
    setup();
    mockCommand('system_open', () => null);
    const user = userEvent.setup();
    mount();
    const tree = await screen.findByRole('tree', { name: 'Changes' });
    const row = await within(tree).findByRole('treeitem', { name: 'app.ts' });
    await user.pointer({ keys: '[MouseRight]', target: row });
    await user.click(
      await screen.findByRole('menuitem', { name: 'Copy filename' }),
    );
    expect(await navigator.clipboard.readText()).toBe('app.ts');
    await user.pointer({ keys: '[MouseRight]', target: row });
    await user.click(
      await screen.findByRole('menuitem', { name: 'Copy path' }),
    );
    expect(await navigator.clipboard.readText()).toBe('/fixture/src/app.ts');
    await user.pointer({ keys: '[MouseRight]', target: row });
    await user.click(
      await screen.findByRole('menuitem', { name: 'Open in default editor' }),
    );
    expect(calls).toContainEqual({
      command: 'system_open',
      args: { repo: repository.id, path: 'src/app.ts' },
    });
  });
  it('offers no menu on folders and serves the all files tree', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    const tree = await screen.findByRole('tree', { name: 'Changes' });
    await user.pointer({
      keys: '[MouseRight]',
      target: await within(tree).findByRole('treeitem', { name: 'src' }),
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Files/ }));
    const files = await screen.findByRole('tree', { name: 'All files' });
    await user.pointer({
      keys: '[MouseRight]',
      target: await within(files).findByRole('treeitem', { name: 'app.ts' }),
    });
    await user.click(
      await screen.findByRole('menuitem', { name: 'Copy filename' }),
    );
    expect(await navigator.clipboard.readText()).toBe('app.ts');
  });
  it('lists new ignored files in the all files tree without a status change', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^Files/ }));
    const files = await screen.findByRole('tree', { name: 'All files' });
    expect(
      await within(files).findByRole('treeitem', { name: 'app.ts' }),
    ).toBeVisible();
    mockCommand('tree', () => [
      {
        path: 'src/app.ts',
        name: 'app.ts',
        directory: false,
        ignored: false,
        status: 'M',
      },
      {
        path: 'out.js',
        name: 'out.js',
        directory: false,
        ignored: true,
        status: '',
      },
    ]);
    const statusReads = count('status');
    act(() => emit('repo://files-changed', { repo: repository.id }));
    expect(
      await within(files).findByRole('treeitem', { name: 'out.js' }),
    ).toBeVisible();
    expect(count('status')).toBe(statusReads);
  });
  it('builds native full paths for Windows roots', () => {
    expect(absolutePath('\\\\?\\C:\\repo', 'src/app.ts')).toBe(
      'C:\\repo\\src\\app.ts',
    );
    expect(absolutePath('C:\\repo', 'a.txt')).toBe('C:\\repo\\a.txt');
  });
});

describe('diff context gaps', () => {
  function gaps(text: string | null = gappedText) {
    setup();
    mockCommand('diff', () => gapped);
    mockCommand('file_lines', () => text);
  }
  it('labels every gap from the hunk headers before fetching the file', async () => {
    gaps();
    const pane = renderFile({ path: 'src/app.ts', source: 'unstaged' });
    expect(await screen.findByText('26 hidden lines above')).toBeVisible();
    expect(screen.getByText('13 hidden lines')).toBeVisible();
    expect(screen.getByText('Rest of file hidden')).toBeVisible();
    expect(
      screen.getByLabelText('Show 20 more lines above hunk 1'),
    ).toBeVisible();
    expect(
      screen.queryByLabelText('Show 20 more lines below hunk 0'),
    ).toBeNull();
    expect(screen.getByLabelText('Show all 13 lines')).toBeVisible();
    expect(
      screen.queryByLabelText('Show 20 more lines above hunk 2'),
    ).toBeNull();
    expect(count('file_lines')).toBe(0);
    pane.unmount();
  });
  it('reveals twenty lines per step and fetches the file text once', async () => {
    gaps();
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
    expect(
      screen.queryByLabelText('Show 20 more lines above hunk 1'),
    ).toBeNull();
    expect(calls).toContainEqual({
      command: 'file_lines',
      args: { repo: repository.id, path: 'src/app.ts', source: 'unstaged' },
    });
    expect(count('file_lines')).toBe(1);
  });
  it('closes a gap with show all and moves focus to its hunk header', async () => {
    gaps();
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
    gaps();
    const user = userEvent.setup();
    renderFile({ path: 'src/app.ts', source: 'unstaged' });
    await user.click(await screen.findByTitle('Show full file'));
    expect(await screen.findByTitle('Collapse to changes')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('26 hidden lines above')).toBeNull();
    await action('context');
    expect(await screen.findByText('26 hidden lines above')).toBeVisible();
    expect(screen.getByTitle('Show full file')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
  it('explains a file too large to expand', async () => {
    gaps(null);
    const user = userEvent.setup();
    renderFile({ path: 'src/app.ts', source: 'unstaged' });
    await user.click(await screen.findByLabelText('Show all 13 lines'));
    expect(await screen.findAllByText('File too large to expand')).toHaveLength(
      3,
    );
    expect(screen.queryByText('Show all')).toBeNull();
  });
  it('spans split columns with one labelled row', async () => {
    gaps();
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
    getSelection()!.selectAllChildren(previous);
    fireEvent.pointerUp(previous);
    expect(document.body).toHaveFocus();
    expect(getSelection()!.toString()).not.toBe('');
    getSelection()!.removeAllRanges();
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
    gaps();
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
    expect(toggles).toHaveLength(2);
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
});

describe('diff interaction', () => {
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
      .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByLabelText('Copy file path'));
    expect(await screen.findByLabelText('Copied')).toBeVisible();
    expect(await navigator.clipboard.readText()).toBe('src/app.ts');
  });
  it('uses the registry for hunk actions, view controls, and system opening', async () => {
    setup();
    useSelection
      .getState()
      .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
    mockCommand('hunk_action', () => null);
    mockCommand('system_open', () => null);
    mount();
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
      await action(id);
    expect(calls.filter((call) => call.command === 'hunk_action')).toHaveLength(
      2,
    );
    await screen.findByTitle('Stage hunk');
    expect(screen.getByTitle('Stage hunk')).toBeEnabled();
    await action('stage-hunk');
    expect(calls.at(-1)?.command).toBe('hunk_action');
    expect(calls.at(-1)?.args).not.toHaveProperty('context');
    dialog.approved = false;
    await action('discard-hunk');
    expect(calls.filter((call) => call.command === 'hunk_action')).toHaveLength(
      3,
    );
  });
  it('runs image comparison and zoom actions through the shared registry', async () => {
    render(
      <ImageDiff
        repo={repository.id}
        selection={{ path: 'image.png', source: 'staged' }}
        diff={diff}
      />,
    );
    for (const mode of ['swipe', 'onion skin', 'side by side']) {
      await action('image-mode');
      expect(screen.getByRole('radio', { name: mode })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }
    await action('image-zoom-in');
    expect(screen.getByAltText('Before')).toHaveStyle('--image-width: 700px');
    await action('image-zoom-out');
    expect(screen.getByAltText('Before')).toHaveStyle('--image-width: 600px');
    await action('image-fit');
    expect(screen.getByAltText('Before')).toHaveClass('max-w-full');
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
  it('keeps the image mode and swipe position through a re-selection', async () => {
    mockCommand('diff', () => ({ ...diff, image: true }));
    const user = userEvent.setup();
    const pane = (path: string) => (
      <QueryProvider>
        <DiffPane
          repo={repository.id}
          selection={{ path, source: 'unstaged' }}
          settings={settings}
          disabled={false}
        />
      </QueryProvider>
    );
    const { rerender } = render(pane('before.png'));
    await user.click(await screen.findByRole('radio', { name: 'swipe' }));
    const divider = screen.getByRole('slider', { name: 'Swipe divider' });
    fireEvent.pointerDown(divider);
    fireEvent.pointerMove(divider, { clientX: 600 });
    expect(divider).toHaveAttribute('aria-valuenow', '75');
    fireEvent.error(screen.getByAltText('Before'));
    expect(screen.getByText(/Image could not be decoded/)).toBeVisible();
    rerender(pane('after.png'));
    expect(
      await screen.findByRole('slider', { name: 'Swipe divider' }),
    ).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByRole('radio', { name: 'swipe' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.queryByText(/Image could not be decoded/),
    ).not.toBeInTheDocument();
  });
  it('opens oversized images externally without offering an in-app override', async () => {
    setup();
    useSelection
      .getState()
      .select(repository.id, { path: 'large.png', source: 'file' });
    mockCommand('diff', () => ({
      ...diff,
      image: true,
      tooLarge: true,
      newSize: 21 * 1024 * 1024,
    }));
    mockCommand('system_open', () => null);
    mount();
    await screen.findByText('File too large to diff');
    expect(screen.queryByText('View anyway')).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByText('Open in system application'));
    expect(calls).toContainEqual({
      command: 'system_open',
      args: { repo: repository.id, path: 'large.png' },
    });
  });
  it('renders both image dimensions, their delta, and decoding errors', () => {
    render(
      <ImageDiff
        repo={repository.id}
        selection={{ path: 'image.png', source: 'staged' }}
        diff={{
          ...diff,
          oldDimensions: { width: 20, height: 30 },
          newDimensions: { width: 25, height: 40 },
        }}
      />,
    );
    expect(screen.getByText(/20×30 → 25×40/)).toBeVisible();
    fireEvent.error(screen.getByAltText('After'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Image could not be decoded',
    );
    expect(
      within(screen.getByLabelText('Image comparison mode')).getAllByRole(
        'radio',
      ),
    ).toHaveLength(3);
  });
});

describe('keyboard and pointer access', () => {
  it('offers the palette and open command before a repository is open', async () => {
    setup();
    useTabs.getState().close(repository.id);
    mockCommand('repo_open', () => repository);
    dialog.path = repository.id;
    const user = userEvent.setup();
    mount();
    await screen.findByText('No repository open');
    fireEvent.keyDown(window, { key: 'p', metaKey: true, shiftKey: true });
    const palette = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    await user.click(
      within(palette).getByRole('button', { name: /Open repository/ }),
    );
    await screen.findByLabelText('Commit message');
    await action('close-repository');
    expect(await screen.findByText('No repository open')).toBeVisible();
  });
  it('finds files with F2 and opens the chosen one in the diff view', async () => {
    setup();
    mockCommand('files', ({ ignored }) =>
      ignored
        ? ['README.md', 'src/app.ts', 'new.txt', 'dist/bundle.js']
        : ['README.md', 'src/app.ts', 'new.txt'],
    );
    const user = userEvent.setup();
    mount();
    const message = await screen.findByLabelText('Commit message');
    fireEvent.keyDown(message, { key: 'F2' });
    const palette = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    const input = within(palette).getByLabelText('Find file');
    const readme = await within(palette).findByRole('button', {
      name: /README\.md/,
    });
    expect(readme).toBeVisible();
    fireEvent.mouseEnter(readme);
    expect(readme).not.toHaveAttribute('title', 'README.md');
    const overflow = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockReturnValue(100);
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
    expect(
      within(palette).getByText('No file matches “missing”'),
    ).toBeVisible();
    expect(
      within(palette).queryByText('Include ignored files to widen the search'),
    ).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'sapt');
    expect(within(palette).getAllByRole('button', { name: /\./ })).toHaveLength(
      1,
    );
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
    expect(useSelection.getState().working[repository.id]).toEqual({
      path: 'src/app.ts',
      source: 'unstaged',
    });
    fireEvent.keyDown(window, { key: 'p', metaKey: true, shiftKey: true });
    const commands = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    const search = within(commands).getByLabelText('Find command');
    expect(search).toHaveValue('');
    await user.type(search, 'zzz');
    expect(
      within(commands).getByText('No command matches “zzz”'),
    ).toBeVisible();
    expect(
      within(commands).getByText('Press F2 to search files instead'),
    ).toBeVisible();
    await user.clear(search);
    const highlighted = () =>
      commands.querySelector<HTMLElement>('[data-current]');
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
    fireEvent.mouseEnter(second!);
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
    mount();
    const sidebar = await screen.findByLabelText('Resize sidebar');
    expect(fireEvent.pointerDown(sidebar)).toBe(false);
    expect(sidebar).toHaveFocus();
    fireEvent.pointerMove(sidebar, { clientX: 500 });
    expect(sidebar).toHaveAttribute('aria-valuenow', '500');
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
    fireEvent.pointerMove(sections, { clientY: 300 });
    expect(sections).toHaveAttribute('aria-valuenow', '50');
    const messageHandle = screen.getByLabelText('Resize commit message');
    fireEvent.keyDown(messageHandle, { key: 'ArrowDown' });
    expect(useLayout.getState().tabs[repository.id].messageHeight).toBe(90);
    fireEvent.pointerDown(messageHandle);
    fireEvent.pointerMove(messageHandle, { clientY: 400 });
    expect(messageHandle).toHaveAttribute('aria-valuenow', '200');
    await user.click(screen.getByRole('button', { name: /^Files/ }));
    expect(screen.getByRole('button', { name: /^Files/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await action('new-branch');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    await action('new-branch');
    mockCommand('branch_create', () => null);
    mockCommand('branch_switch', () => null);
    await user.type(screen.getByLabelText('Name'), 'new{Enter}');
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'branch_switch',
        args: { repo: repository.id, name: 'new' },
      }),
    );
    await action('delete-branch');
    expect(await screen.findByLabelText('Filter branches')).toBeVisible();
  });
  it('drags the image swipe and keeps it bounded at both edges', async () => {
    const user = userEvent.setup();
    render(
      <ImageDiff
        repo={repository.id}
        selection={{ path: 'image.png', source: 'staged' }}
        diff={diff}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'swipe' }));
    const divider = screen.getByLabelText('Swipe divider');
    fireEvent.pointerDown(divider);
    fireEvent.pointerMove(divider, { clientX: 600 });
    expect(divider).toHaveAttribute('aria-valuenow', '75');
    fireEvent.pointerMove(divider, { clientX: 900 });
    expect(divider).toHaveAttribute('aria-valuenow', '100');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider).toHaveAttribute('aria-valuenow', '99');
    fireEvent.pointerMove(divider, { clientX: -10 });
    expect(divider).toHaveAttribute('aria-valuenow', '0');
  });
});
describe('rendered Markdown', () => {
  it('shows the new version as prose, drops the toolbar, and strips scripts', async () => {
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
      .select(repository.id, { path: 'README.md', source: 'unstaged' });
    mount();
    expect(await screen.findByRole('radio', { name: 'split' })).toBeVisible();
    await action('rendered');
    expect(
      await screen.findByRole('heading', { name: 'Release notes' }),
    ).toBeVisible();
    expect(screen.getByText('Kept sentence.')).toBeVisible();
    expect(screen.queryByText('Dropped sentence.')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'split' })).toBeNull();
    const article = screen.getByRole('article');
    expect(article.querySelector('script')).toBeNull();
    expect(article.querySelector('code')).toHaveTextContent('pnpm install');
    await waitFor(() =>
      expect(article.querySelector('code span[style]')).not.toBeNull(),
    );
    expect(workers.jobs.map((job) => job.path)).toContain('fence.bash');
    await action('rendered');
    expect(await screen.findByRole('radio', { name: 'split' })).toBeVisible();
  });
  it('renders the last version of a deleted file behind a notice', async () => {
    setup();
    mockCommand('diff', () =>
      markdownDiff([{ kind: 'remove', content: '# Removed doc' }]),
    );
    useSelection
      .getState()
      .select(repository.id, { path: 'README.md', source: 'unstaged' });
    mount();
    expect(
      await screen.findByRole('button', { name: /Rendered/ }),
    ).toBeVisible();
    await action('rendered');
    expect(await screen.findByText(/This file was deleted/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Removed doc' })).toBeVisible();
  });
  it('offers the control only for Markdown and keeps it exclusive with blame', async () => {
    setup();
    mockCommand('blame', () => blameLines);
    useSelection
      .getState()
      .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
    mount();
    expect(await screen.findByRole('button', { name: /Blame/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Rendered/ })).toBeNull();
    mockCommand('diff', () =>
      markdownDiff([{ kind: 'add', content: '# Doc' }]),
    );
    await act(async () => {
      useSelection.getState().select(repository.id, {
        path: 'README.md',
        source: 'unstaged',
        blame: true,
      });
    });
    await action('rendered');
    const selected = useSelection.getState().working[repository.id];
    expect(selected?.rendered).toBe(true);
    expect(selected?.blame).toBe(false);
    expect(await screen.findByRole('button', { name: /Source/ })).toBeVisible();
    await action('blame');
    expect(useSelection.getState().working[repository.id]?.rendered).toBe(
      false,
    );
  });
});
describe('find in file', () => {
  const needles = () =>
    rows(200, (index) =>
      index % 50 === 0 ? `needle ${index}` : `const row${index} = ${index};`,
    );
  const counter = () => within(screen.getByRole('search')).getByRole('status');
  const current = () =>
    [...document.querySelectorAll('.bg-find-current')].map(
      (span) => span.textContent,
    );
  it('opens with the shortcut, cycles matches with wrap-around, and closes with Escape', async () => {
    setup();
    useDiffView.getState().setMode('unified');
    mockCommand('diff', needles);
    useSelection
      .getState()
      .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
    const user = userEvent.setup();
    mount();
    const surface = await screen.findByRole('region', { name: 'Diff content' });
    await within(surface).findByText(/needle 0/);
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    const input = await screen.findByRole('textbox', { name: 'Find in file' });
    expect(input).toHaveFocus();
    const scroll = vi.mocked(HTMLElement.prototype.scrollTo);
    scroll.mockClear();
    await user.type(input, 'NEEDLE');
    expect(counter()).toHaveTextContent('1 of 4');
    expect(current()).toEqual(['needle']);
    expect(scroll).toHaveBeenCalled();
    scroll.mockClear();
    await user.keyboard('{Enter}');
    expect(counter()).toHaveTextContent('2 of 4');
    expect(scroll).toHaveBeenCalled();
    await user.keyboard('{Shift>}{Enter}{Enter}{/Shift}');
    expect(counter()).toHaveTextContent('4 of 4');
    await user.click(screen.getByRole('button', { name: 'Next match' }));
    expect(counter()).toHaveTextContent('1 of 4');
    await user.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(counter()).toHaveTextContent('4 of 4');
    await user.click(surface);
    fireEvent.keyDown(window, { key: 'F3' });
    expect(counter()).toHaveTextContent('1 of 4');
    fireEvent.keyDown(input, { key: 'F3', shiftKey: true });
    expect(counter()).toHaveTextContent('4 of 4');
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
    expect(counter()).toHaveTextContent('No results');
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('search')).toBeNull();
    expect(current()).toEqual([]);
    expect(surface).toHaveFocus();
  });
  it('searches the blame lines and closes from its button', async () => {
    setup();
    mockCommand('blame', () => [
      ...blameLines,
      { ...blameLines[0], line: 2, content: 'second first', block: false },
    ]);
    const user = userEvent.setup();
    renderFile({ path: 'src/app.ts', source: 'unstaged', blame: true });
    const lines = await screen.findByLabelText('Blame lines');
    await within(lines).findByText('first');
    await action('find');
    await user.type(
      screen.getByRole('textbox', { name: 'Find in file' }),
      'first',
    );
    expect(counter()).toHaveTextContent('1 of 2');
    expect(current()).toEqual(['first']);
    await user.keyboard('{Enter}');
    expect(counter()).toHaveTextContent('2 of 2');
    expect(
      [...lines.querySelectorAll('.bg-find')].map((span) => span.textContent),
    ).toEqual(['first']);
    await user.click(screen.getByRole('button', { name: 'Close find' }));
    expect(screen.queryByRole('search')).toBeNull();
  });
});
