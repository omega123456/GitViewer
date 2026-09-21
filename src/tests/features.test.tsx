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
import App from '../App';
import { Providers } from '../providers';
import { QueryProvider } from '../providers/QueryProvider';
import { registeredActions } from '../lib/actions';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { useDiffView } from '../stores/diff-view';
import { useImageViews } from '../stores/image-view';
import { useSettingsNav } from '../stores/settings-nav';
import { initials } from '../components/shared/Avatar';
import { checkout } from '../components/shell/BranchPopover';
import { DiffPane } from '../components/diff/DiffPane';
import { ImageDiff } from '../components/image/ImageDiff';
import { mockCommand, dialog, calls, emit } from './harness';
import { settings, status, repository, diff } from './fixtures';

const commit = {
  hash: 'a'.repeat(40),
  parents: ['b'.repeat(40)],
  author: 'Author',
  timestamp: 1700000000,
  subject: 'Review commit',
  refs: 'main',
  lane: 0,
  segments: [{ from: 0, to: 1 }],
};
const branches = [
  { name: 'main', current: true, remote: false, upstream: 'origin/main' },
  { name: 'feature', current: false, remote: false, upstream: '' },
  { name: 'origin/main', current: false, remote: true, upstream: '' },
];
function setup() {
  mockCommand('env', () => ({
    found: true,
    supported: true,
    version: '2.50.1',
  }));
  mockCommand('settings_get', () => settings);
  mockCommand('status', () => status);
  mockCommand('tree', () => [
    {
      path: 'src/app.ts',
      name: 'app.ts',
      directory: false,
      ignored: false,
      status: 'M',
    },
  ]);
  mockCommand('stashes', () => []);
  mockCommand('history', () => ({ commits: [commit], cursor: null }));
  mockCommand('commit_files', () => ['src/app.ts']);
  mockCommand('branches', () => branches);
  mockCommand('diff', () => diff);
  mockCommand('refresh', () => null);
  mockCommand('files_action', () => null);
  mockCommand('sync', () => null);
  mockCommand('stash_save', () => 'stash-hash');
  mockCommand('repo_close', () => null);
  useTabs.getState().open(repository.id, repository.name);
}
function mount() {
  return render(
    <Providers>
      <App />
    </Providers>,
  );
}
async function action(id: string) {
  await act(async () => {
    const entry = registeredActions(repository.id).find(
      (entry) => entry.id === id,
    );
    expect(entry, id).toBeDefined();
    expect(entry?.disabled, id).not.toBe(true);
    await entry?.run();
  });
}

describe('repository workflows', () => {
  it('stages and reverts from visible sidebar controls, respecting cancellation', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Stage all' }));
    expect(calls).toContainEqual({
      command: 'files_action',
      args: {
        repo: repository.id,
        paths: ['src/app.ts', 'new.txt'],
        action: 'stage',
      },
    });
    await user.click(
      screen.getAllByRole('button', { name: 'Revert all in src' })[0],
    );
    expect(calls).toContainEqual({
      command: 'files_action',
      args: { repo: repository.id, paths: ['src/app.ts'], action: 'revert' },
    });
    dialog.approved = false;
    await user.click(
      screen.getByRole('button', { name: 'Revert all changes' }),
    );
    expect(
      calls.filter((call) => call.command === 'files_action'),
    ).toHaveLength(2);
    dialog.approved = true;
    await user.click(
      screen.getByRole('button', { name: 'Revert all changes' }),
    );
    expect(calls).toContainEqual({
      command: 'files_action',
      args: {
        repo: repository.id,
        paths: ['src/app.ts', 'new.txt'],
        action: 'revert',
      },
    });
    await user.click(screen.getByRole('button', { name: 'Revert new.txt' }));
    expect(calls).toContainEqual({
      command: 'files_action',
      args: { repo: repository.id, paths: ['new.txt'], action: 'revert' },
    });
    const print = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(print);
    expect(print.defaultPrevented).toBe(true);
    const copy = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);
  });
  it('scopes bulk verbs to their own group and drops an empty group', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole('button', { name: 'Unstage all' }),
    );
    expect(calls).toContainEqual({
      command: 'files_action',
      args: { repo: repository.id, paths: ['src/app.ts'], action: 'unstage' },
    });
    await user.click(
      screen.getByRole('button', { name: 'Revert all staged changes' }),
    );
    expect(calls).toContainEqual({
      command: 'files_action',
      args: { repo: repository.id, paths: ['src/app.ts'], action: 'revert' },
    });
    await user.type(screen.getByLabelText('Filter files'), 'new');
    expect(
      screen.queryByRole('button', { name: 'Unstage all' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Revert all staged changes' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stage all' })).toBeVisible();
    await user.clear(screen.getByLabelText('Filter files'));
    await user.type(screen.getByLabelText('Filter files'), 'zzz');
    expect(await screen.findByText('No files match the filter')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Stage all' }),
    ).not.toBeInTheDocument();
  });
  it('creates from another reference, filters groups, switches and confirms deletion', async () => {
    setup();
    mockCommand('branch_create', () => null);
    mockCommand('branch_switch', () => null);
    mockCommand('branch_delete', () => null);
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Commit message');
    await action('branches');
    expect(await screen.findByText('Local branches')).toBeVisible();
    expect(screen.getByText('Remote branches')).toBeVisible();
    await user.type(screen.getByLabelText('Filter branches'), 'feature');
    expect(screen.queryByText('Remote branches')).not.toBeInTheDocument();
    await user.click(screen.getByTitle('Delete feature'));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'branch_delete',
        args: { repo: repository.id, name: 'feature' },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'New branch' }));
    await user.type(screen.getByLabelText('Name'), 'new-feature');
    await user.clear(screen.getByLabelText('Based on'));
    await user.type(screen.getByLabelText('Based on'), 'origin/main');
    await user.click(screen.getByLabelText('Switch to it after creating'));
    await user.click(screen.getByRole('button', { name: 'Create branch' }));
    expect(calls).toContainEqual({
      command: 'branch_create',
      args: {
        repo: repository.id,
        name: 'new-feature',
        base: 'origin/main',
        checkout: false,
      },
    });
    expect(calls.some((call) => call.command === 'branch_switch')).toBe(false);
    await action('branches');
    await user.click(
      await screen.findByRole('button', { name: /feature.*local/ }),
    );
    expect(calls).toContainEqual({
      command: 'branch_switch',
      args: { repo: repository.id, name: 'feature' },
    });
  });
  it('runs smart checkout only after a blocking failure and preserves the error on cancellation', async () => {
    setup();
    mockCommand('branch_switch', () => {
      throw {
        category: 'refused',
        message: 'file.txt would be overwritten by checkout',
      };
    });
    mockCommand('smart_checkout', () => null);
    await checkout(repository.id, 'feature');
    expect(calls.some((call) => call.command === 'smart_checkout')).toBe(true);
    expect(useTabs.getState().busy).toBe(0);
    dialog.approved = false;
    await checkout(repository.id, 'feature');
    expect(useTabs.getState().error?.message).toContain('file.txt');
    expect(
      calls.filter((call) => call.command === 'smart_checkout'),
    ).toHaveLength(1);
  });
  it('runs registered repository navigation, synchronization, and file actions', async () => {
    setup();
    useTabs.getState().open('/second', 'Second');
    useTabs.getState().activate(repository.id);
    const user = userEvent.setup();
    mount();
    await screen.findAllByLabelText('Commit message');
    await action('next-file');
    expect(useSelection.getState().working[repository.id]?.source).toBe(
      'staged',
    );
    await action('next-file');
    expect(useSelection.getState().working[repository.id]?.source).toBe(
      'unstaged',
    );
    await screen.findByTitle('Stage hunk');
    await action('stage');
    await action('unstage');
    dialog.approved = false;
    await action('discard-file');
    expect(
      calls.filter((call) => call.command === 'files_action'),
    ).toHaveLength(2);
    dialog.approved = true;
    await action('discard-file');
    await action('all');
    await action('previous-file');
    for (const id of [
      'fetch',
      'pull',
      'push',
      'stash',
      'refresh',
      'next-tab',
      'previous-tab',
    ])
      await action(id);
    expect(useTabs.getState().active).toBe(repository.id);
    expect(calls.filter((call) => call.command === 'sync')).toHaveLength(3);
    fireEvent.focus(window);
    await waitFor(() =>
      expect(
        calls.filter((call) => call.command === 'refresh').length,
      ).toBeGreaterThan(1),
    );
    await user.click(screen.getByLabelText('Close Second'));
    expect(useTabs.getState().tabs).toHaveLength(1);
  });
  it('remembers history selection and independent sidebar widths, and opens blame commits', async () => {
    setup();
    useSelection
      .getState()
      .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
    mockCommand('blame', () => [
      {
        hash: commit.hash,
        author: 'Author',
        timestamp: commit.timestamp,
        line: 1,
        content: 'first',
        block: true,
      },
      {
        hash: commit.hash,
        author: 'Author',
        timestamp: commit.timestamp,
        line: 2,
        content: 'second',
        block: false,
      },
    ]);
    const user = userEvent.setup();
    mount();
    await screen.findByTitle('Stage hunk');
    await action('file-history');
    await user.click(await screen.findByText('Review commit'));
    expect(useSelection.getState().history[repository.id]?.path).toBe(
      'src/app.ts',
    );
    const fileTree = await screen.findByRole('tree', { name: 'Commit files' });
    await within(fileTree).findByRole('treeitem', { name: 'app.ts' });
    const folder = within(fileTree).getByRole('treeitem', { name: 'src' });
    await user.click(folder);
    expect(
      within(fileTree).queryByRole('treeitem', { name: 'app.ts' }),
    ).not.toBeInTheDocument();
    await user.click(folder);
    await user.click(
      within(fileTree).getByRole('treeitem', { name: 'app.ts' }),
    );
    expect(useSelection.getState().history[repository.id]?.revision).toBe(
      commit.hash,
    );
    await user.click(
      screen.getByRole('button', { name: 'View all changes in commit' }),
    );
    const stack = await screen.findByRole('region', {
      name: 'All changes in commit',
    });
    expect(useSelection.getState().history[repository.id]?.path).toBe('');
    await within(stack).findByText(commit.hash.slice(0, 7));
    await within(stack).findByRole('button', { name: /app\.ts/ });
    expect(within(stack).queryByTitle('Stage hunk')).not.toBeInTheDocument();
    await user.click(
      within(fileTree).getByRole('treeitem', { name: 'app.ts' }),
    );
    await screen.findByRole('region', { name: 'Diff viewer' });
    expect(useSelection.getState().all[repository.id]).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'All files' }));
    await user.click(await screen.findByText('Review commit'));
    await screen.findByRole('region', { name: 'All changes in commit' });
    expect(useSelection.getState().all[repository.id]).toBe('commit');
    fireEvent.keyDown(screen.getByLabelText('Resize sidebar'), {
      key: 'ArrowRight',
    });
    expect(useLayout.getState().tabs[repository.id].historyWidth).toBe(450);
    await action('history');
    expect(useSelection.getState().working[repository.id]?.source).toBe(
      'unstaged',
    );
    fireEvent.keyDown(screen.getByLabelText('Resize sidebar'), {
      key: 'ArrowLeft',
    });
    await user.click(screen.getByRole('button', { name: /^Files/ }));
    fireEvent.keyDown(screen.getByLabelText('Resize files section'), {
      key: 'ArrowUp',
    });
    expect(useLayout.getState().tabs[repository.id].width).toBe(290);
    expect(useLayout.getState().tabs[repository.id].filesHeight).toBe(38);
    await action('blame');
    expect(await screen.findByText('first')).toBeVisible();
    expect(
      within(screen.getByLabelText('Blame lines')).getAllByText(
        initials('Author'),
      ),
    ).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'aaaaaaa' }));
    expect(useSelection.getState().history[repository.id]?.source).toBe(
      'commit',
    );
  });
  it('persists each preference through the backend and refreshes from its event', async () => {
    setup();
    let preferences = settings;
    mockCommand('settings_get', () => preferences);
    mockCommand('settings_set', (next) => {
      preferences = { ...next, keyStored: settings.keyStored };
      emit('settings://changed', null);
      return next;
    });
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Commit message');
    await action('settings');
    await user.click(screen.getByRole('radio', { name: 'dark' }));
    await waitFor(() =>
      expect(document.querySelector('main')).toHaveAttribute(
        'data-theme',
        'dark',
      ),
    );
    await user.click(screen.getByRole('radio', { name: 'compact' }));
    await user.click(screen.getByRole('radio', { name: 'unified' }));
    await waitFor(() =>
      expect(preferences).toEqual({
        ...settings,
        theme: 'dark',
        density: 'compact',
        diffMode: 'unified',
      }),
    );
    const rail = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(
      within(rail).getByRole('button', { name: 'General' }),
    ).toHaveAttribute('aria-current', 'page');
    await user.click(within(rail).getByRole('button', { name: 'Updates' }));
    expect(
      await screen.findByRole('region', { name: 'Updates' }),
    ).toBeVisible();
    expect(useSettingsNav.getState().pane).toBe('updates');
    await user.click(screen.getByLabelText('Close dialog'));
    expect(useSettingsNav.getState().pane).toBe('general');
    expect(useDiffView.getState().mode).toBeNull();
  });
  it('shows stash files and uses hash-addressed apply, pop, and drop with confirmations', async () => {
    setup();
    mockCommand('stashes', () => [
      {
        hash: 'stash-hash',
        selector: 'stash@{0}',
        message: 'Saved experiment',
        timestamp: commit.timestamp,
      },
    ]);
    mockCommand('stash_apply', ({ smart }) => {
      if (!smart)
        throw {
          category: 'smart_apply',
          message: 'Local changes need a smart apply',
        };
      return null;
    });
    mockCommand('stash_drop', () => null);
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Commit message');
    await user.click(await screen.findByRole('button', { name: /Stashes/ }));
    await user.click(
      await screen.findByRole('button', { name: /Saved experiment/ }),
    );
    const fileTree = await screen.findByRole('tree', { name: 'Stash files' });
    await within(fileTree).findByRole('treeitem', { name: 'app.ts' });
    const folder = within(fileTree).getByRole('treeitem', { name: 'src' });
    await user.click(folder);
    expect(
      within(fileTree).queryByRole('treeitem', { name: 'app.ts' }),
    ).not.toBeInTheDocument();
    await user.click(folder);
    await user.click(
      within(fileTree).getByRole('treeitem', { name: 'app.ts' }),
    );
    expect(useSelection.getState().working[repository.id]?.source).toBe(
      'stash',
    );
    await action('apply-stash');
    expect(calls).toContainEqual({
      command: 'stash_apply',
      args: {
        repo: repository.id,
        hash: 'stash-hash',
        pop: false,
        smart: true,
      },
    });
    dialog.approved = false;
    await action('pop-stash');
    await action('drop-stash');
    expect(calls.some((call) => call.command === 'stash_drop')).toBe(false);
    dialog.approved = true;
    await action('pop-stash');
    await action('drop-stash');
    expect(calls).toContainEqual({
      command: 'stash_drop',
      args: { repo: repository.id, hash: 'stash-hash' },
    });
  });
  it('disables detached-head synchronization and displays failures honestly', async () => {
    setup();
    mockCommand('status', () => ({ ...status, branch: '(detached)' }));
    const user = userEvent.setup();
    mount();
    await screen.findByText('This commit will be created on detached HEAD.');
    expect(screen.getByRole('button', { name: /pull/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /push/i })).toBeDisabled();
    mockCommand('sync', () => {
      throw { category: 'authentication', message: 'Credentials rejected' };
    });
    await action('fetch');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'authentication: Credentials rejected',
    );
    await user.click(screen.getByLabelText('Dismiss error'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('diff interaction', () => {
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
      'context',
    ])
      await action(id);
    expect(calls.filter((call) => call.command === 'hunk_action')).toHaveLength(
      2,
    );
    await screen.findByTitle('Stage hunk');
    expect(screen.getByTitle('Stage hunk')).toBeEnabled();
    await action('stage-hunk');
    expect(calls.at(-1)).toMatchObject({
      command: 'hunk_action',
      args: { context: 30 },
    });
    await action('context');
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
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Image could not be decoded',
    );
    rerender(pane('after.png'));
    expect(
      await screen.findByRole('slider', { name: 'Swipe divider' }),
    ).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByRole('radio', { name: 'swipe' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    expect(screen.getByRole('alert')).toHaveTextContent(
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
    mockCommand('files', () => ['README.md', 'src/app.ts', 'new.txt']);
    const user = userEvent.setup();
    useLayout.getState().update(repository.id, { history: true });
    mount();
    const message = await screen.findByLabelText('Commit message');
    fireEvent.keyDown(message, { key: 'F2' });
    const palette = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    const input = within(palette).getByLabelText('Find file');
    expect(
      await within(palette).findByRole('button', { name: /README\.md/ }),
    ).toBeVisible();
    await user.type(input, 'missing');
    expect(within(palette).getByText('No matching file.')).toBeVisible();
    await user.clear(input);
    await user.type(input, 'sapt');
    expect(within(palette).getAllByRole('button')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(useLayout.getState().tabs[repository.id]?.history).toBe(false);
    expect(useSelection.getState().working[repository.id]).toEqual({
      path: 'src/app.ts',
      source: 'unstaged',
    });
    fireEvent.keyDown(window, { key: 'p', metaKey: true, shiftKey: true });
    const commands = await screen.findByRole('dialog', {
      name: 'Command palette',
    });
    expect(within(commands).getByLabelText('Find command')).toHaveValue('');
    await user.click(
      within(commands).getByRole('button', { name: /Go to file/ }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Command palette' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Find file')).toBeVisible();
  });
  it('drags both splitters within their announced bounds and collapses trees', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    const sidebar = await screen.findByLabelText('Resize sidebar');
    fireEvent.pointerDown(sidebar);
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
    await user.click(screen.getByRole('button', { name: /^Files/ }));
    expect(screen.getByRole('button', { name: /^Files/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await action('new-branch');
    await user.type(screen.getByLabelText('Name'), 'new');
    mockCommand('branch_create', () => null);
    mockCommand('branch_switch', () => null);
    await user.click(screen.getByRole('button', { name: 'Create branch' }));
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
describe('all changes pane', () => {
  it('stacks every file of a group, collapses files, and returns on selection', async () => {
    setup();
    mockCommand('diff', (args) =>
      args.path === 'new.txt'
        ? { ...diff, path: 'new.txt', image: true, hunks: [], patches: [] }
        : diff,
    );
    mockCommand('hunk_action', () => null);
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole('button', { name: 'View all changes' }),
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
        context: 3,
        patch: 'patch',
        action: 'stage',
      },
    });
    await user.click(within(pane).getByRole('button', { name: /app\.ts/ }));
    expect(within(pane).queryByTitle('Stage hunk')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'View all staged changes' }),
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
});
