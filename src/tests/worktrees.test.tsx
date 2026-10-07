import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { registeredActions } from '../lib/actions';
import { closeRepository, switchWorktree } from '../lib/repository';
import type { Status, Worktree } from '../lib/types';
import { track } from '../stores/activity';
import { useErrors } from '../stores/errors';
import { useTabs } from '../stores/tabs';
import { repository, status } from './fixtures';
import { calls, dialog, emit, mockCommand } from './harness';
import { action, branches, mount, run, settled, setup } from './workbench';

const main = repository.id;
function worktree(id: string, extra: Partial<Worktree> = {}): Worktree {
  return {
    id,
    name: id.split('/').at(-1)!,
    main: false,
    bare: false,
    branch: '',
    oid: 'f'.repeat(40),
    detached: false,
    locked: null,
    prunable: false,
    missing: false,
    ...extra,
  };
}
const statuses: Record<string, Status> = {
  [main]: status,
  '/wt/hotfix': {
    ...status,
    branch: 'fix',
    entries: [
      ...status.entries,
      { kind: 'untracked', path: 'more.txt', index: '?', worktree: '?' },
    ],
  },
  '/wt/review': { ...status, branch: 'feature', entries: [] },
  '/wt/spike': {
    ...status,
    branch: '(detached)',
    oid: '3f9c2a1bb',
    entries: [],
  },
  '/wt/release': { ...status, branch: 'release', entries: [] },
};
let list: Worktree[];
function project(extra: Worktree[] = []) {
  setup();
  list = [
    worktree(main, { main: true, branch: 'main' }),
    worktree('/wt/hotfix', { branch: 'fix' }),
    worktree('/wt/review', { branch: 'feature' }),
    worktree('/wt/spike', { detached: true, oid: '3f9c2a1bb' }),
    worktree('/wt/release', { branch: 'release', locked: 'on drive' }),
    worktree('/wt/legacy', { branch: 'legacy', missing: true, prunable: true }),
    ...extra,
  ];
  mockCommand('worktrees', () => list);
  mockCommand('status', ({ repo }) => statuses[repo] ?? status);
  mockCommand('repo_open', ({ path }) => ({
    ...repository,
    id: path,
    name: path.split('/').at(-1)!,
    root: path,
    project: main,
    status: statuses[path] ?? status,
  }));
  mockCommand('worktree_prune', () => null);
  mockCommand('branches', () => [
    { ...branches[0], worktree: main },
    { ...branches[1], worktree: '/wt/review' },
    branches[2],
  ]);
}
const tab = () => useTabs.getState().tabs[0];
async function opened() {
  mount();
  await waitFor(() => expect(tab().members).toHaveLength(5));
  await settled();
}
const trigger = () =>
  screen.getByRole('button', {
    name: /^(fixture|hotfix|review|spike)\//,
  });

describe('worktrees', () => {
  it('opens every present worktree with the project and marks the others', async () => {
    project();
    await opened();
    expect(useTabs.getState().tabs).toHaveLength(1);
    expect(tab().members).toEqual([
      main,
      '/wt/hotfix',
      '/wt/review',
      '/wt/spike',
      '/wt/release',
    ]);
    expect(tab().view).toBe(main);
    expect(trigger()).toHaveTextContent('fixture/main');
    expect(
      screen.getByRole('img', {
        name: 'Another worktree has uncommitted changes',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('fixture', { selector: 'footer *' })).toBeVisible();
    await action('branches');
    const list = await screen.findByLabelText('Branches');
    expect(within(list).getByText('Worktrees')).toBeVisible();
    const row = (name: string) =>
      within(list).getByRole('button', { name: new RegExp(`^${name}`) });
    expect(row('fixture')).toBeDisabled();
    expect(row('hotfix')).toHaveTextContent('fix3');
    expect(
      within(row('hotfix')).getByRole('img', { name: 'Uncommitted changes' }),
    ).toBeInTheDocument();
    expect(row('spike')).toHaveTextContent('3f9c2a1 detached');
    expect(
      within(row('release')).getByRole('img', { name: 'Locked' }),
    ).toBeInTheDocument();
    expect(row('release').querySelector('[title="on drive"]')).not.toBeNull();
    expect(row('legacy')).toBeDisabled();
    expect(row('legacy')).toHaveTextContent('missing');
    expect(
      within(row('legacy')).getByRole('img', { name: 'Folder missing' }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Filter worktrees and branches'),
    ).toBeVisible();
  });
  it('switches in place and keeps each worktree its own draft', async () => {
    project();
    await opened();
    act(() => useTabs.getState().setMessage(main, 'main draft'));
    const sidebar = () =>
      screen.getByRole('slider', { name: 'Resize sidebar' });
    fireEvent.keyDown(sidebar(), { key: 'ArrowRight' });
    await action('branches');
    fireEvent.click(
      within(await screen.findByLabelText('Branches')).getByRole('button', {
        name: /^hotfix/,
      }),
    );
    await act(() => settled());
    expect(tab().view).toBe('/wt/hotfix');
    expect(screen.queryByLabelText('Branches')).toBeNull();
    expect(sidebar()).toHaveAttribute('aria-valuenow', '310');
    expect(useTabs.getState().active).toBe(main);
    expect(trigger()).toHaveTextContent('hotfix/fix');
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
      '',
    );
    expect(screen.getByText('Switched to worktree hotfix')).toBeInTheDocument();
    expect(
      registeredActions(main).some((entry) => entry.id === 'branches'),
    ).toBe(false);
    await run('/wt/hotfix', `worktree:${main}`);
    expect(tab().view).toBe(main);
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
      'main draft',
    );
  });
  it('sends a branch checked out elsewhere to its worktree and keeps it from deletion', async () => {
    project();
    await opened();
    const user = userEvent.setup();
    await action('branches');
    const list = screen.getByLabelText('Branches');
    await user.click(
      within(list).getByRole('button', { name: 'Actions for feature' }),
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Delete branch' }),
    ).toHaveAttribute('data-disabled');
    expect(screen.getByText('Checked out in review')).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(
      within(list).getByRole('button', { name: /^feature.*in review/ }),
    );
    expect(tab().view).toBe('/wt/review');
    expect(screen.queryByLabelText('Branches')).toBeNull();
    expect(calls.some((call) => call.command === 'branch_switch')).toBe(false);
  });
  it('prunes missing worktrees through the main worktree', async () => {
    project();
    await opened();
    const user = userEvent.setup();
    await action('branches');
    await user.click(screen.getByRole('button', { name: 'Prune missing' }));
    expect(calls).toContainEqual({
      command: 'worktree_prune',
      args: { repo: main },
    });
  });
  it('drops a worktree whose folder went missing and falls back to the main one', async () => {
    project();
    await opened();
    await act(() => switchWorktree(tab(), '/wt/review'));
    expect(tab().view).toBe('/wt/review');
    list = list.map((entry) =>
      entry.id === '/wt/review' ? { ...entry, missing: true } : entry,
    );
    act(() => emit('repo://status-changed', { repo: main }));
    await waitFor(() => expect(tab().view).toBe(main));
    expect(tab().members).not.toContain('/wt/review');
    expect(calls).toContainEqual({
      command: 'repo_close',
      args: { repo: '/wt/review' },
    });
    expect(await screen.findByText('Worktree review is missing')).toBeVisible();
    expect(screen.getByText('Showing fixture')).toBeVisible();
  });
  it('opens a worktree that appeared after the project before showing it', async () => {
    project();
    await opened();
    const sidebar = () =>
      screen.getByRole('slider', { name: 'Resize sidebar' });
    fireEvent.keyDown(sidebar(), { key: 'ArrowLeft' });
    await act(() => switchWorktree(tab(), '/wt/late'));
    expect(tab().members).toContain('/wt/late');
    expect(tab().view).toBe('/wt/late');
    expect(sidebar()).toHaveAttribute('aria-valuenow', '290');
    mockCommand('repo_open', () => {
      throw new Error('gone');
    });
    await act(() => switchWorktree(tab(), '/wt/later'));
    expect(tab().view).toBe('/wt/late');
  });
  it('rolls every worktree into the project tab indicators', async () => {
    project();
    await opened();
    act(() => useTabs.getState().open('/other', 'other'));
    const projectTab = screen.getByRole('button', { name: /^fixture/ });
    expect(projectTab).toHaveAttribute(
      'title',
      'fixture · worktree fixture on main',
    );
    expect(
      within(projectTab.parentElement!).getByRole('img', {
        name: 'Uncommitted changes',
      }),
    ).toBeInTheDocument();
    act(() =>
      useErrors
        .getState()
        .report('/wt/review', { category: 'refused', message: 'nope' }),
    );
    expect(
      within(projectTab).getByRole('img', { name: 'Errors waiting' }),
    ).toBeInTheDocument();
    let stop = () => {};
    act(() => {
      stop = track('/wt/spike', 'sync', { repo: '/wt/spike', action: 'fetch' });
    });
    await waitFor(() =>
      expect(
        within(projectTab).getByRole('img', { name: 'Git operation running' }),
      ).toBeInTheDocument(),
    );
    act(() => stop());
  });
  it('marks running and failing worktrees in the menu and on the button', async () => {
    project();
    await opened();
    act(() =>
      useErrors
        .getState()
        .report('/wt/review', { category: 'refused', message: 'nope' }),
    );
    expect(
      screen.getByRole('img', { name: 'Errors waiting in another worktree' }),
    ).toBeInTheDocument();
    let stop = () => {};
    act(() => {
      stop = track('/wt/spike', 'sync', { repo: '/wt/spike', action: 'fetch' });
    });
    await action('branches');
    const list = screen.getByLabelText('Branches');
    expect(
      within(within(list).getByRole('button', { name: /^review/ })).getByRole(
        'img',
        { name: 'Errors waiting' },
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(within(list).getByRole('button', { name: /^spike/ })).getByRole(
          'img',
          { name: 'Git operation running' },
        ),
      ).toBeInTheDocument(),
    );
    act(() => stop());
  });
  it('filters worktrees with branches and lists palette entries', async () => {
    project();
    await opened();
    const user = userEvent.setup();
    const labels = registeredActions(main)
      .filter((entry) => entry.id.startsWith('worktree'))
      .map((entry) => entry.label);
    expect(labels).toEqual([
      'Switch worktree…',
      'Switch to worktree hotfix',
      'Switch to worktree review',
      'Switch to worktree spike',
      'Switch to worktree release',
    ]);
    await run(main, 'worktrees');
    await user.type(
      screen.getByLabelText('Filter worktrees and branches'),
      'release',
    );
    const list = screen.getByLabelText('Branches');
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([expect.stringMatching(/^release/), '']);
  });
  it('lands a linked folder in its project tab', async () => {
    project();
    await opened();
    dialog.path = '/wt/spike';
    await action('open');
    expect(useTabs.getState().tabs).toHaveLength(1);
    expect(tab().view).toBe('/wt/spike');
    expect(trigger()).toHaveTextContent('spike/3f9c2a1 · detached');
  });
  it('closes every worktree together after one confirmation', async () => {
    project();
    await opened();
    act(() => useTabs.getState().setMessage('/wt/hotfix', 'draft'));
    dialog.approved = false;
    await act(() => closeRepository(tab()));
    expect(dialog.asked).toBe(1);
    expect(useTabs.getState().tabs).toHaveLength(1);
    dialog.approved = true;
    await act(() => closeRepository(tab()));
    expect(
      calls
        .filter((call) => call.command === 'repo_close')
        .map((call) => (call.args as { repo: string }).repo),
    ).toEqual([main, '/wt/hotfix', '/wt/review', '/wt/spike', '/wt/release']);
    expect(useTabs.getState().tabs).toEqual([]);
    expect(useTabs.getState().messages).toEqual({});
  });
  it('lists a bare project without opening it', async () => {
    setup();
    act(() => useTabs.getState().close(main));
    list = [
      worktree('/srv/bare.git', { main: true, bare: true }),
      worktree('/wt/one', { branch: 'one' }),
      worktree('/wt/two', { branch: 'two' }),
    ];
    mockCommand('worktrees', () => list);
    mockCommand('repo_open', ({ path }) => ({
      ...repository,
      id: path,
      root: path,
      project: '/srv/bare.git',
    }));
    dialog.path = '/wt/one';
    mount();
    await screen.findByText('No repository open');
    await action('open');
    await waitFor(() => expect(tab()?.members).toHaveLength(2));
    expect(tab().id).toBe('/srv/bare.git');
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    const bare = within(await screen.findByLabelText('Branches')).getByRole(
      'button',
      { name: /^bare\.git/ },
    );
    expect(bare).toBeDisabled();
    expect(bare).toHaveTextContent('bare');
  });
});

describe('worktree actions', () => {
  function actions() {
    project();
    mockCommand('worktree_target', ({ mode, ref, path }) => ({
      path:
        path ||
        `/wt/fixture-${mode === 'detached' ? '3f9c2a1' : ref.replace(/^origin\//, '').replaceAll('/', '-')}`,
      free: path !== '/wt/taken',
      label: mode === 'detached' ? '3f9c2a1' : ref,
    }));
    mockCommand('worktree_add', ({ path }) => path);
    mockCommand('worktree_summary', ({ repo }) => ({
      ahead: repo === '/wt/review' ? 0 : 2,
      orphans: repo === '/wt/spike' ? 2 : 0,
      submodules: false,
    }));
    mockCommand('worktree_remove', () => null);
    mockCommand('worktree_unapply', () => null);
    mockCommand('worktree_apply', () => ({
      base: 'b'.repeat(40),
      tree: 'c'.repeat(40),
      files: 6,
      conflicts: 0,
    }));
  }
  const menuFor = async (name: string, view = main) => {
    const user = userEvent.setup();
    await run(view, 'branches');
    await user.click(
      within(screen.getByLabelText('Branches')).getByRole('button', {
        name: `Actions for ${name}`,
      }),
    );
    return user;
  };
  const changes = (repo: string) => statuses[repo].entries.length;
  it('creates a detached worktree beside the project by default and switches to it', async () => {
    actions();
    await opened();
    const user = userEvent.setup();
    await action('branches');
    const branchList = screen.getByLabelText('Branches');
    expect(
      within(branchList).queryByRole('button', { name: 'Actions for fixture' }),
    ).toBeNull();
    expect(
      within(branchList).queryByRole('button', { name: 'Actions for legacy' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New worktree' }));
    const form = await screen.findByRole('dialog', { name: 'New worktree' });
    expect(
      within(form).getByRole('radio', { name: 'detached' }),
    ).toHaveAttribute('aria-checked', 'true');
    const folder = within(form).getByLabelText('Folder');
    await waitFor(() => expect(folder).toHaveValue('/wt/fixture-3f9c2a1'));
    expect(within(form).getByText('3f9c2a1')).toBeVisible();
    await user.clear(folder);
    await user.type(folder, '/wt/taken');
    expect(
      await within(form).findByText(
        'This folder already exists and is not empty.',
      ),
    ).toBeVisible();
    expect(
      within(form).getByRole('button', { name: 'Create & switch' }),
    ).toBeDisabled();
    await user.clear(folder);
    await user.type(folder, '/wt/fresh');
    const create = within(form).getByRole('button', {
      name: 'Create & switch',
    });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);
    expect(calls).toContainEqual({
      command: 'worktree_add',
      args: {
        repo: main,
        path: '/wt/fresh',
        mode: 'detached',
        branch: '',
        base: 'main',
      },
    });
    await waitFor(() => expect(tab().view).toBe('/wt/fresh'));
    expect(await screen.findByText('Created worktree fresh')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'New worktree' })).toBeNull();
  });
  it('creates worktrees on a new or an existing branch without switching', async () => {
    actions();
    mockCommand('branches', () => [
      { ...branches[0], worktree: main },
      { ...branches[1], worktree: '/wt/review' },
      { name: 'idle', current: false, remote: false, upstream: '' },
      branches[2],
    ]);
    await opened();
    const user = userEvent.setup();
    await run(main, 'new-worktree');
    let form = await screen.findByRole('dialog', { name: 'New worktree' });
    await user.click(within(form).getByRole('radio', { name: 'new branch' }));
    await user.type(within(form).getByLabelText('Branch name'), 'main');
    expect(
      within(form).getByText('A branch named “main” already exists.'),
    ).toBeVisible();
    await user.clear(within(form).getByLabelText('Branch name'));
    await user.type(within(form).getByLabelText('Branch name'), 'feature/x');
    await waitFor(() =>
      expect(within(form).getByLabelText('Folder')).toHaveValue(
        '/wt/fixture-feature-x',
      ),
    );
    await user.click(
      within(form).getByRole('button', { name: 'Create worktree options' }),
    );
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Create only' }),
    );
    await user.click(within(form).getByRole('button', { name: 'Create only' }));
    expect(calls).toContainEqual({
      command: 'worktree_add',
      args: {
        repo: main,
        path: '/wt/fixture-feature-x',
        mode: 'new',
        branch: 'feature/x',
        base: 'main',
      },
    });
    expect(tab().view).toBe(main);
    await run(main, 'new-worktree');
    form = await screen.findByRole('dialog', { name: 'New worktree' });
    expect(
      within(form).getByRole('radio', { name: 'detached' }),
    ).toHaveAttribute('aria-checked', 'true');
    await user.click(
      within(form).getByRole('radio', { name: 'existing branch' }),
    );
    expect(
      within(form).getByRole('button', { name: 'Create only' }),
    ).toBeDisabled();
    await user.click(within(form).getByLabelText('Branch'));
    expect(screen.queryByRole('option', { name: /^feature/ })).toBeNull();
    expect(screen.getByRole('option', { name: 'idle' })).toBeVisible();
    await user.click(screen.getByRole('option', { name: /^origin\/main/ }));
    expect(within(form).getByText('main', { selector: 'span' })).toBeVisible();
    await waitFor(() =>
      expect(within(form).getByLabelText('Folder')).toHaveValue(
        '/wt/fixture-main',
      ),
    );
    dialog.path = '/picked';
    await user.click(within(form).getByRole('button', { name: 'Choose…' }));
    await waitFor(() =>
      expect(within(form).getByLabelText('Folder')).toHaveValue('/picked'),
    );
    await user.click(within(form).getByRole('button', { name: 'Create only' }));
    expect(calls).toContainEqual({
      command: 'worktree_add',
      args: {
        repo: main,
        path: '/picked',
        mode: 'existing',
        branch: 'origin/main',
        base: 'main',
      },
    });
  });
  it('applies a worktree to main from its row and undoes it from the toast', async () => {
    actions();
    await opened();
    const user = await menuFor('hotfix');
    const apply = await screen.findByRole('menuitem', {
      name: 'Apply to main checkout',
    });
    expect(apply).toHaveAttribute(
      'title',
      'Apply all changes to fixture on main',
    );
    await user.click(apply);
    expect(calls).toContainEqual({
      command: 'worktree_apply',
      args: { repo: main, source: '/wt/hotfix', target: main, smart: false },
    });
    expect(await screen.findByText('Applied to main')).toBeVisible();
    expect(screen.getByText('6 files changed in fixture.')).toBeVisible();
    expect(tab().view).toBe(main);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(calls).toContainEqual({
      command: 'worktree_unapply',
      args: {
        repo: main,
        target: main,
        base: 'b'.repeat(40),
        tree: 'c'.repeat(40),
      },
    });
    expect(await screen.findByText('Undid apply')).toBeVisible();
  });
  it('disables apply when the worktree has nothing new and reports a no-op', async () => {
    actions();
    await opened();
    await menuFor('review');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Apply to main checkout' }),
      ).toHaveAttribute('data-disabled'),
    );
    expect(
      screen.getByText('No changes since it split from main'),
    ).toBeVisible();
    mockCommand('worktree_apply', () => ({
      base: 'b'.repeat(40),
      tree: 'c'.repeat(40),
      files: 0,
      conflicts: 0,
    }));
    await run(main, 'apply:/wt/review');
    expect(await screen.findByText('Nothing to apply')).toBeVisible();
  });
  it('asks before stashing overlapping main changes and shows conflicts in main', async () => {
    actions();
    mockCommand('worktree_apply', ({ smart }) => {
      if (!smart)
        throw {
          category: 'overlap',
          message: 'Main has changes to:\nsrc/app.ts\nsrc/lib.ts',
        };
      return {
        base: 'b'.repeat(40),
        tree: 'c'.repeat(40),
        files: 2,
        conflicts: 2,
      };
    });
    await opened();
    await act(() => switchWorktree(tab(), '/wt/hotfix'));
    const user = userEvent.setup();
    await run('/wt/hotfix', 'apply:/wt/spike');
    const decision = await screen.findByRole('dialog', {
      name: 'Apply spike to main?',
    });
    expect(within(decision).getByText('src/lib.ts')).toBeVisible();
    await user.click(
      within(decision).getByRole('button', { name: 'Stash and apply' }),
    );
    expect(calls).toContainEqual({
      command: 'worktree_apply',
      args: {
        repo: '/wt/hotfix',
        source: '/wt/spike',
        target: main,
        smart: true,
      },
    });
    expect(
      await screen.findByText('Applied to main with 2 conflicts'),
    ).toBeVisible();
    expect(tab().view).toBe('/wt/hotfix');
    await user.click(screen.getByRole('button', { name: 'Show main' }));
    await waitFor(() => expect(tab().view).toBe(main));
    mockCommand('worktree_apply', () => {
      throw { category: 'refused', message: 'Main is busy' };
    });
    await run(main, 'apply:/wt/spike');
    await waitFor(() =>
      expect(useErrors.getState().scopes[main]).toHaveLength(1),
    );
  });
  it('confirms deletion with what is lost and leaves the worktree first', async () => {
    actions();
    await opened();
    await act(() => switchWorktree(tab(), '/wt/spike'));
    dialog.approved = false;
    const user = await menuFor('spike', '/wt/spike');
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete worktree…' }),
    );
    await waitFor(() => expect(dialog.asked).toBe(1));
    expect(dialog.title).toBe('Delete worktree spike?');
    expect(dialog.message).toBe(
      '2 commits are on no branch and will be lost. This deletes the folder /wt/spike, including ignored files.',
    );
    expect(calls.some((call) => call.command === 'worktree_remove')).toBe(
      false,
    );
    dialog.approved = true;
    await run('/wt/spike', 'delete-worktree');
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'worktree_remove',
        args: { repo: main, worktree: '/wt/spike', force: 0 },
      }),
    );
    expect(tab().view).toBe(main);
    expect(tab().members).not.toContain('/wt/spike');
    const order = calls.map((call) => call.command);
    expect(order.lastIndexOf('repo_close')).toBeLessThan(
      order.indexOf('worktree_remove'),
    );
    expect(await screen.findByText('Deleted worktree spike')).toBeVisible();
  });
  it('forces deletion of dirty and locked worktrees after saying so', async () => {
    actions();
    await opened();
    let user = await menuFor('hotfix');
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete worktree…' }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'worktree_remove',
        args: { repo: main, worktree: '/wt/hotfix', force: 1 },
      }),
    );
    expect(dialog.message).toBe(
      `Its ${changes('/wt/hotfix')} uncommitted changes will be lost. This deletes the folder /wt/hotfix, including ignored files. The branch fix is kept.`,
    );
    user = await menuFor('release');
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete worktree…' }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'worktree_remove',
        args: { repo: main, worktree: '/wt/release', force: 2 },
      }),
    );
    expect(dialog.title).toBe('release is locked');
    expect(dialog.message).toBe(
      'Reason: “on drive”\n\nDelete it anyway? This deletes the folder /wt/release, including ignored files. The branch release is kept.',
    );
    mockCommand('worktree_summary', () => {
      throw { category: 'refused', message: 'Summary failed' };
    });
    user = await menuFor('review');
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete worktree…' }),
    );
    await waitFor(() =>
      expect(useErrors.getState().scopes[main]?.length).toBeGreaterThan(0),
    );
  });
});
