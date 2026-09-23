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
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { ImageDiff } from '../components/image/ImageDiff';
import { absolutePath } from '../components/shared/FileMenu';
import { highlight } from '../lib/highlight';
import { client } from '../lib/query';
import { mockCommand, dialog, calls, emit, lastError } from './harness';
import { intersect, intersecting } from './setup';
import { settings, status, repository, diff, stack } from './fixtures';
import type { Diff, DiffStack } from '../lib/types';
import type { Stack } from '../stores/selection';

vi.mock('../lib/highlight', async (original) => {
  const actual = await original<typeof import('../lib/highlight')>();
  return { ...actual, highlight: vi.fn(actual.highlight) };
});

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
  mockCommand('commit_files', () => ({ 'src/app.ts': 'M' }));
  mockCommand('branches', () => branches);
  mockCommand('diff', () => diff);
  mockCommand('diff_stack', () => stack);
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
const settled = () => new Promise((resolve) => setTimeout(resolve, 250));
const count = (command: string) =>
  calls.filter((call) => call.command === command).length;
const picture = {
  ...diff,
  path: 'photo.png',
  image: true,
  hunks: [],
  patches: [],
};
const height = (block: HTMLElement) =>
  within(block)
    .getByText('Loading…')
    .style.getPropertyValue('--virtual-height');
const shown = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('code')].filter((code) =>
    code.textContent?.includes(text),
  ).length;
const colored = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.text-syntax')].filter(
    (span) => span.style.getPropertyValue('--syntax-color') !== 'inherit',
  ).length;
async function renderStack(stack: Stack = 'commit') {
  const view = render(
    <QueryProvider>
      <AllChangesPane
        repo={repository.id}
        stack={stack}
        commit={
          stack === 'commit'
            ? { path: '', source: 'commit', revision: commit.hash }
            : undefined
        }
        status={status}
        settings={settings}
        disabled={false}
      />
    </QueryProvider>,
  );
  const labels: Record<string, string> = {
    commit: 'All changes in commit',
    unstaged: 'All changes',
  };
  const pane = await screen.findByRole('region', { name: labels[stack] });
  return Object.assign(pane, { unmount: view.unmount });
}
function renderFile(selection: Parameters<typeof DiffPane>[0]['selection']) {
  return render(
    <QueryProvider>
      <DiffPane
        repo={repository.id}
        selection={selection}
        settings={settings}
        disabled={false}
      />
    </QueryProvider>,
  );
}
function restart() {
  calls.length = 0;
  client.clear();
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
      screen.getAllByRole('button', { name: 'Discard all in src' })[0],
    );
    expect(calls).toContainEqual({
      command: 'files_action',
      args: { repo: repository.id, paths: ['src/app.ts'], action: 'revert' },
    });
    dialog.approved = false;
    await user.click(
      screen.getByRole('button', { name: 'Discard all changes' }),
    );
    expect(
      calls.filter((call) => call.command === 'files_action'),
    ).toHaveLength(2);
    dialog.approved = true;
    await user.click(
      screen.getByRole('button', { name: 'Discard all changes' }),
    );
    expect(calls).toContainEqual({
      command: 'files_action',
      args: {
        repo: repository.id,
        paths: ['src/app.ts', 'new.txt'],
        action: 'revert',
      },
    });
    await user.click(screen.getByRole('button', { name: 'Discard new.txt' }));
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
      screen.getByRole('button', { name: 'Discard all staged changes' }),
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
      screen.queryByRole('button', { name: 'Discard all staged changes' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stage all' })).toBeVisible();
    await user.clear(screen.getByLabelText('Filter files'));
    await user.type(screen.getByLabelText('Filter files'), 'zzz');
    expect(await screen.findByText('No files match the filter')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Stage all' }),
    ).not.toBeInTheDocument();
  });
  it('collapses and expands every folder of a group from its header', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    const tree = await screen.findByRole('tree', { name: 'Changes' });
    await within(tree).findByRole('treeitem', { name: 'app.ts' });
    await user.click(
      screen.getByRole('button', { name: 'Collapse all Changes' }),
    );
    expect(
      within(tree).queryByRole('treeitem', { name: 'app.ts' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Expand all Changes' }),
    );
    expect(
      await within(tree).findByRole('treeitem', { name: 'app.ts' }),
    ).toBeVisible();
    await user.type(screen.getByLabelText('Filter files'), 'new');
    expect(
      screen.queryByRole('button', { name: /all Changes$/ }),
    ).not.toBeInTheDocument();
  });
  it('expands a folder that appears after a status refresh', async () => {
    setup();
    let current = status;
    mockCommand('status', () => current);
    mount();
    const tree = await screen.findByRole('tree', { name: 'Changes' });
    await within(tree).findByRole('treeitem', { name: 'app.ts' });
    current = {
      ...status,
      entries: [
        ...status.entries,
        {
          kind: 'untracked',
          path: 'docs/guide.md',
          index: '?',
          worktree: '?',
        },
      ],
    };
    act(() => emit('repo://status-changed', { repo: repository.id }));
    expect(
      await within(tree).findByRole('treeitem', { name: 'guide.md' }),
    ).toBeVisible();
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
    await user.click(
      screen.getByRole('button', { name: 'Actions for feature' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete branch' }),
    );
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
  it('merges a branch after the preview, skips an up to date branch, and respects cancellation', async () => {
    setup();
    mockCommand('merge_preview', () => ({
      outcome: 'conflict' as const,
      changed: 12,
      conflicts: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    }));
    mockCommand('branch_merge', () => null);
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Commit message');
    const merge = async () => {
      await action('branches');
      await user.click(
        await screen.findByRole('button', { name: 'Actions for feature' }),
      );
      await user.click(
        await screen.findByRole('menuitem', { name: 'Merge into main' }),
      );
    };
    await merge();
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'branch_merge',
        args: { repo: repository.id, name: 'feature' },
      }),
    );
    dialog.approved = false;
    mockCommand('merge_preview', () => ({
      outcome: 'fastForward' as const,
      changed: 1,
      conflicts: [],
    }));
    await merge();
    await waitFor(() =>
      expect(
        calls.filter((call) => call.command === 'merge_preview'),
      ).toHaveLength(2),
    );
    expect(
      calls.filter((call) => call.command === 'branch_merge'),
    ).toHaveLength(1);
    dialog.approved = true;
    mockCommand('merge_preview', () => ({
      outcome: 'upToDate' as const,
      changed: 0,
      conflicts: [],
    }));
    await merge();
    await waitFor(() =>
      expect(
        calls.filter((call) => call.command === 'merge_preview'),
      ).toHaveLength(3),
    );
    expect(
      calls.filter((call) => call.command === 'branch_merge'),
    ).toHaveLength(1);
  });
  it('asks in place before smart checkout and preserves the error on cancellation', async () => {
    setup();
    mockCommand('branch_switch', () => {
      throw {
        category: 'refused',
        message:
          'error: Your local changes to the following files would be overwritten by checkout:\n\tfile.txt\nAborting',
      };
    });
    mockCommand('smart_checkout', () => null);
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Commit message');
    const switched = checkout(repository.id, 'feature');
    const card = await screen.findByRole('dialog', {
      name: 'Switch to feature?',
    });
    expect(within(card).getByText('file.txt')).toBeVisible();
    expect(
      within(card).getByRole('button', { name: 'Stash and switch' }),
    ).toHaveFocus();
    await user.click(
      within(card).getByRole('button', { name: 'Stash and switch' }),
    );
    await act(() => switched);
    expect(calls.some((call) => call.command === 'smart_checkout')).toBe(true);
    expect(useTabs.getState().busy).toBe(0);
    const cancelled = checkout(repository.id, 'feature');
    await screen.findByRole('dialog', { name: 'Switch to feature?' });
    await user.keyboard('{Escape}');
    await act(() => cancelled);
    expect(lastError(repository.id)?.message).toContain('file.txt');
    expect(
      calls.filter((call) => call.command === 'smart_checkout'),
    ).toHaveLength(1);
    mockCommand('branch_switch', () => {
      throw { category: 'refused', message: 'error: unknown branch' };
    });
    await act(() => checkout(repository.id, 'missing'));
    expect(lastError(repository.id)?.message).toBe('error: unknown branch');
    mockCommand('branch_switch', () => null);
    await act(() => checkout(repository.id, 'feature'));
    expect(lastError(repository.id)).toBeUndefined();
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
    expect(within(fileTree).getByText('M')).toBeInTheDocument();
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
      screen.getByRole('button', { name: 'All changes in commit' }),
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
    await user.click(screen.getByLabelText('Search ignored files'));
    await waitFor(() =>
      expect(preferences).toEqual({
        ...settings,
        theme: 'dark',
        density: 'compact',
        diffMode: 'unified',
        searchIgnoredFiles: true,
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
    expect(
      screen.queryByLabelText('Resize stash section'),
    ).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Stashes/ }));
    const handle = screen.getByLabelText('Resize stash section');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(useLayout.getState().tabs[repository.id].stashHeight).toBe(28);
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(handle, { clientY: 300 });
    expect(handle).toHaveAttribute('aria-valuenow', '50');
    await user.click(
      await screen.findByRole('button', { name: /Saved experiment/ }),
    );
    const fileTree = await screen.findByRole('tree', { name: 'Stash files' });
    await within(fileTree).findByRole('treeitem', { name: 'app.ts' });
    const filesHandle = screen.getByLabelText('Resize stash files');
    fireEvent.keyDown(filesHandle, { key: 'ArrowDown' });
    expect(useLayout.getState().tabs[repository.id].stashFilesHeight).toBe(52);
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
    await user.click(screen.getByLabelText('All changes in stash'));
    expect(useSelection.getState().all[repository.id]).toBe('commit');
    await screen.findByRole('region', { name: 'All changes in stash' });
    const smartApply = (pop: boolean) => ({
      command: 'stash_apply',
      args: { repo: repository.id, hash: 'stash-hash', pop, smart: true },
    });
    const decide = async (label: string) => {
      const card = await screen.findByRole('dialog', {
        name: 'Combine with your changes?',
      });
      await user.click(within(card).getByRole('button', { name: label }));
    };
    await user.click(screen.getByLabelText('Apply stash@{0}'));
    await decide('Apply and combine');
    await waitFor(() => expect(calls).toContainEqual(smartApply(false)));
    const stashMutations = () =>
      calls.filter((call) => call.command.startsWith('stash_')).length;
    dialog.approved = false;
    const gated = stashMutations();
    await action('apply-stash');
    await action('pop-stash');
    await action('drop-stash');
    expect(stashMutations()).toBe(gated);
    dialog.approved = true;
    await action('drop-stash');
    expect(calls).toContainEqual({
      command: 'stash_drop',
      args: { repo: repository.id, hash: 'stash-hash' },
    });
    await user.click(screen.getByLabelText('Pop stash@{0}'));
    await decide('Cancel');
    expect(calls).not.toContainEqual(smartApply(true));
    await user.click(screen.getByLabelText('Pop stash@{0}'));
    await decide('Pop and combine');
    await waitFor(() => expect(calls).toContainEqual(smartApply(true)));
    mockCommand('stash_apply', () => {
      throw { category: 'refused', message: 'error: conflict' };
    });
    await action('apply-stash');
    expect(lastError(repository.id)?.message).toBe('error: conflict');
    mockCommand('stash_apply', () => null);
    await action('apply-stash');
    expect(lastError(repository.id)).toBeUndefined();
    const dropped = stashMutations();
    await user.click(screen.getByLabelText('Drop stash@{0}'));
    expect(stashMutations()).toBeGreaterThan(dropped);
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
    expect(
      await screen.findByText('Sign-in to the remote failed'),
    ).toBeVisible();
    expect(screen.getByText('Credentials rejected')).toBeVisible();
    await user.click(screen.getByLabelText('Dismiss error'));
    expect(
      screen.queryByText('Sign-in to the remote failed'),
    ).not.toBeInTheDocument();
  });
});

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
  it('builds native full paths for Windows roots', () => {
    expect(absolutePath('\\\\?\\C:\\repo', 'src/app.ts')).toBe(
      'C:\\repo\\src\\app.ts',
    );
    expect(absolutePath('C:\\repo', 'a.txt')).toBe('C:\\repo\\a.txt');
  });
});

describe('diff interaction', () => {
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
    expect(
      await within(palette).findByRole('button', { name: /README\.md/ }),
    ).toBeVisible();
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
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
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
  it('shows a loading state until the commit file list arrives', async () => {
    setup();
    let release: (files: Record<string, string>) => void = () => {};
    mockCommand(
      'commit_files',
      () =>
        new Promise<Record<string, string>>((resolve) => (release = resolve)),
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
    await act(async () => release({ 'src/app.ts': 'A' }));
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
    mockCommand('commit_files', () => ({ 'src/app.ts': 'M', 'new.txt': 'A' }));
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
      mockCommand('commit_files', () => ({ 'src/app.ts': 'M', 'lib.ts': 'M' }));
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
      }).parentElement!;
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
    mockCommand('commit_files', () => ({ 'src/app.ts': 'M', 'lib.ts': 'M' }));
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
  it('mounts surfaces near the viewport and keeps their height once far away', async () => {
    setup();
    intersecting.initially = false;
    mockCommand('commit_files', () => ({
      'src/app.ts': 'M',
      'photo.png': 'M',
    }));
    mockCommand('diff_stack', () => ({
      files: { 'src/app.ts': diff, 'photo.png': picture },
      truncated: false,
    }));
    const pane = await renderStack();
    await waitFor(() => expect(count('diff_stack')).toBe(1));
    const block = within(pane).getByRole('button', {
      name: /app\.ts/,
    }).parentElement!;
    const image = within(pane).getByRole('button', {
      name: /photo\.png/,
    }).parentElement!;
    await waitFor(() =>
      expect(within(block).getByText('Loading…')).toHaveClass('h-virtual'),
    );
    expect(height(block)).toBe('64px');
    expect(within(image).getByText('Loading…')).toHaveClass('min-h-32');
    expect(shown(pane, 'new value')).toBe(0);
    expect(pane.querySelector('img')).toBeNull();
    act(() => intersect(block, true));
    await act(settled);
    expect(shown(block, 'new value')).toBe(1);
    act(() => intersect(block, false));
    await act(settled);
    expect(shown(block, 'new value')).toBe(1);
    act(() => intersect(block, false, '2000px'));
    expect(shown(block, 'new value')).toBe(0);
    expect(height(block)).toBe('600px');
    act(() => intersect(image, true));
    await act(settled);
    expect(image.querySelector('img')).not.toBeNull();
  });
  it('highlights a stacked file only near the viewport and drops stale tokens', async () => {
    setup();
    intersecting.initially = false;
    const spy = vi.mocked(highlight);
    spy.mockClear();
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
    }).parentElement!;
    await act(settled);
    expect(spy).not.toHaveBeenCalled();
    act(() => intersect(block, true));
    await act(settled);
    await waitFor(() => expect(colored(block)).toBeGreaterThan(0));
    const highlighted = spy.mock.calls.length;
    act(() => intersect(block, false));
    await act(settled);
    expect(colored(block)).toBeGreaterThan(0);
    current = changed;
    act(() => emit('repo://head-changed', { repo: repository.id }));
    await waitFor(() => expect(shown(block, 'new value;')).toBe(1));
    expect(colored(block)).toBe(0);
    expect(spy.mock.calls.length).toBe(highlighted);
  });
  it('keeps the previous tokens of the file pane until new ones arrive', async () => {
    setup();
    const spy = vi.mocked(highlight);
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
    mockCommand('diff', () => ({ ...diff }));
    spy
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => new Promise(() => {}));
    await action('context');
    await waitFor(() => expect(count('diff')).toBe(2));
    await waitFor(() => expect(shown(pane, 'new value')).toBe(1));
    expect(colored(pane)).toBeGreaterThan(0);
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
    await action('context');
    await waitFor(() => expect(count('diff')).toBe(1));
    selected.unmount();
    const working = await renderStack('unstaged');
    await waitFor(() => expect(count('diff_stack')).toBe(2));
    working.unmount();
    renderFile({ path: 'src/app.ts', source: 'unstaged' }).unmount();
    await waitFor(() => expect(count('diff')).toBe(2));
    act(() => {
      void client.invalidateQueries({
        queryKey: [repository.id, 'diff_stack'],
      });
    });
    renderFile({ path: 'new.txt', source: 'commit', revision: commit.hash });
    await waitFor(() => expect(count('diff')).toBe(3));
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
        context: 3,
        patch: 'patch',
        action: 'stage',
      },
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
      { name: 'island', current: false, remote: false, upstream: '' },
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

function markdownDiff(lines: { kind: string; content: string }[]) {
  return {
    ...diff,
    path: 'README.md',
    content: null,
    hunks: [
      {
        header: `@@ -1,${lines.length} +1,${lines.length} @@`,
        oldStart: 1,
        oldCount: lines.length,
        newStart: 1,
        newCount: lines.length,
        lines: lines.map((line, index) => ({
          kind: line.kind,
          content: line.content,
          old: line.kind === 'add' ? null : index + 1,
          new: line.kind === 'remove' ? null : index + 1,
          noNewline: false,
          marks: [],
        })),
      },
    ],
  };
}
const blameLines = [
  {
    hash: 'a'.repeat(40),
    author: 'Author',
    timestamp: 1700000000,
    line: 1,
    content: 'first',
    block: true,
  },
];
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
