import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { useDiffView } from '../stores/diff-view';
import { useSettingsNav } from '../stores/settings-nav';
import { initials } from '../components/shared/Avatar';
import { checkout } from '../components/shell/BranchPopover';
import { track } from '../stores/activity';
import {
  mockCommand,
  dialog,
  calls,
  emit,
  lastError,
  pendingActivity,
} from './harness';
import { settings, status, repository } from './fixtures';
import { commit, setup, mount, count, action, run } from './workbench';
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
    const name = screen.getByLabelText('Name');
    expect(name).toHaveFocus();
    expect(screen.getByLabelText('Based on')).toHaveTextContent('maincurrent');
    await user.type(name, 'feature');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A branch named “feature” already exists.',
    );
    expect(
      screen.getByRole('button', { name: 'Create & switch' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Create options' }),
    ).toBeDisabled();
    await user.clear(name);
    await user.type(name, 'bad:name');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Not a valid branch name.',
    );
    await user.clear(name);
    await user.type(name, 'new feature');
    expect(name).toHaveValue('new-feature');
    expect(screen.getByText('Spaces become dashes.')).toBeVisible();
    await user.click(screen.getByLabelText('Based on'));
    expect(await screen.findByText('Remote')).toBeVisible();
    await user.click(screen.getByRole('option', { name: 'origin/main' }));
    await user.click(screen.getByRole('button', { name: 'Create options' }));
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Create only' }),
    );
    await user.click(screen.getByRole('button', { name: 'Create only' }));
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
    mockCommand('branch_merge', () => true);
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
    expect(pendingActivity()).toEqual([]);
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
    for (const id of ['fetch', 'pull', 'push', 'stash', 'refresh', 'next-tab'])
      await action(id);
    expect(useTabs.getState().active).toBe('/second');
    await run('/second', 'previous-tab');
    expect(useTabs.getState().active).toBe(repository.id);
    expect(calls.filter((call) => call.command === 'sync')).toHaveLength(3);
    const refreshed = count('refresh');
    fireEvent.focus(window);
    await waitFor(() => expect(count('refresh')).toBe(refreshed + 1));
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
    await user.click(screen.getByLabelText('Zoom'));
    await user.click(await screen.findByRole('option', { name: '125%' }));
    await user.click(screen.getByLabelText('File tabs'));
    await user.click(await screen.findByRole('option', { name: '5' }));
    await waitFor(() =>
      expect(preferences).toEqual({
        ...settings,
        theme: 'dark',
        density: 'compact',
        diffMode: 'unified',
        searchIgnoredFiles: true,
        zoom: 125,
        maxFileTabs: 5,
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
    await waitFor(() =>
      expect(
        screen.queryByText('Sign-in to the remote failed'),
      ).not.toBeInTheDocument(),
    );
  });
  it('confirms finished actions with success cards beside failures', async () => {
    setup();
    mockCommand('stashes', () => [
      {
        hash: 'stash-hash',
        selector: 'stash@{0}',
        message: 'On main: tidy tests',
        timestamp: commit.timestamp,
      },
    ]);
    mockCommand('stash_drop', () => null);
    mockCommand('stash_restore', () => null);
    mockCommand('sync', () => 3);
    const user = userEvent.setup();
    mount();
    await screen.findAllByLabelText('Commit message');
    await action('push');
    expect(await screen.findByText('Pushed to origin/main')).toBeVisible();
    expect(screen.getByText('3 commits')).toBeVisible();
    mockCommand('sync', () => {
      throw { category: 'network', message: 'fatal: unable to access' };
    });
    await action('fetch');
    expect(await screen.findByText('Could not reach the remote')).toBeVisible();
    mockCommand('sync', () => 0);
    await action('fetch');
    await action('fetch');
    await waitFor(() =>
      expect(
        screen.queryByText('Could not reach the remote'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText('Fetched')).toHaveLength(1);
    expect(screen.getByText('Up to date')).toBeVisible();
    await user.click(screen.getAllByLabelText('Dismiss').at(-1)!);
    await waitFor(() =>
      expect(
        screen.queryByText('Pushed to origin/main'),
      ).not.toBeInTheDocument(),
    );
    await user.click(await screen.findByRole('button', { name: /Stashes/ }));
    await user.click(screen.getByLabelText('Drop stash@{0}'));
    expect(await screen.findByText('Stash dropped')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(calls).toContainEqual({
      command: 'stash_restore',
      args: {
        repo: repository.id,
        hash: 'stash-hash',
        message: 'On main: tidy tests',
      },
    });
    expect(await screen.findByText('Stash restored')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText('Stash dropped')).not.toBeInTheDocument(),
    );
  });
  it('shows a running pull on its button, in the status bar, and on a background tab', async () => {
    setup();
    useTabs.getState().open('/second', 'Second');
    useTabs.getState().activate(repository.id);
    let finish = () => {};
    mockCommand(
      'sync',
      () =>
        new Promise<null>((resolve) => {
          finish = () => resolve(null);
        }),
    );
    mount();
    await screen.findAllByLabelText('Commit message');
    vi.useFakeTimers();
    const [pull] = screen.getAllByRole('button', { name: /pull/i });
    const [push] = screen.getAllByRole('button', { name: /push/i });
    fireEvent.click(pull);
    expect(screen.getAllByText('Ready')).toHaveLength(2);
    act(() => vi.advanceTimersByTime(300));
    expect(pull).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Pulling from origin/main')).toBeVisible();
    expect(push).toBeDisabled();
    expect(screen.getAllByText('Ready')).toHaveLength(1);
    act(() =>
      emit('sync://progress', {
        repo: repository.id,
        message: 'Receiving objects:  45% (9/20)',
        done: false,
      }),
    );
    expect(
      screen.getByText('Pulling from origin/main · Receiving'),
    ).toBeVisible();
    expect(
      screen.getByRole('progressbar', { name: 'Receiving' }),
    ).toHaveAttribute('aria-valuenow', '45');
    await act(async () => finish());
    expect(push).toBeEnabled();
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getAllByText('Ready')).toHaveLength(2);
    expect(pull).toHaveAttribute('aria-busy', 'false');
    let stop = () => {};
    act(() => {
      stop = track('/second', 'sync', { repo: '/second', action: 'push' });
      vi.advanceTimersByTime(300);
    });
    expect(
      screen.getByRole('img', { name: 'Git operation running' }),
    ).toBeVisible();
    act(() => useTabs.getState().activate('/second'));
    expect(screen.getByText('Pushing to origin/main')).toBeVisible();
    act(() => {
      stop();
      vi.advanceTimersByTime(400);
    });
    expect(
      screen.queryByRole('img', { name: 'Git operation running' }),
    ).not.toBeInTheDocument();
  });
});
