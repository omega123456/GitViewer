import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { useFilterStore } from '../stores/filter';
import { useReveal } from '../stores/reveal';
import { absolutePath } from '../lib/paths';
import type { TreeEntry } from '../lib/types';
import { calls, emit, mockCommand } from './harness';
import { repository } from './fixtures';
import { commit, count, mountApp, setup } from './workbench';

async function tabMenu(user: UserEvent, name: string) {
  const strip = await screen.findByRole('tablist', { name: 'Open files' });
  await user.pointer({
    keys: '[MouseRight]',
    target: within(strip).getByRole('tab', { name }),
  });
}

async function revealTab(user: UserEvent, name: string) {
  await tabMenu(user, name);
  await user.click(
    await screen.findByRole('menuitem', { name: 'Reveal in sidebar' }),
  );
}

function treeEntry(path: string, directory = false): TreeEntry {
  return {
    path: path,
    name: path.slice(path.lastIndexOf('/') + 1),
    directory: directory,
    ignored: false,
    status: '',
  };
}

function docsTree(path: string): TreeEntry[] {
  const entriesByPath: Record<string, TreeEntry[]> = {
    '': [treeEntry('docs', true), treeEntry('src', true)],
    docs: [treeEntry('docs/guide.md')],
  };
  return entriesByPath[path] ?? [];
}

it('copies the name and full path and opens a changed file', async () => {
  setup();
  mockCommand('system_open', () => null);
  const user = userEvent.setup();
  mountApp();
  const tree = await screen.findByRole('tree', { name: 'Changes' });
  const row = await within(tree).findByRole('treeitem', { name: 'app.ts' });
  await user.pointer({ keys: '[MouseRight]', target: row });
  await user.click(
    await screen.findByRole('menuitem', { name: 'Copy filename' }),
  );
  expect(calls).toContainEqual({
    command: 'clipboard_write',
    args: { text: 'app.ts' },
  });
  await user.pointer({ keys: '[MouseRight]', target: row });
  await user.click(await screen.findByRole('menuitem', { name: 'Copy path' }));
  expect(calls).toContainEqual({
    command: 'clipboard_write',
    args: { text: '/fixture/src/app.ts' },
  });
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
  mountApp();
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
  expect(calls).toContainEqual({
    command: 'clipboard_write',
    args: { text: 'app.ts' },
  });
});

it('lists new ignored files in the all files tree without a status change', async () => {
  setup();
  const user = userEvent.setup();
  mountApp();
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

it('copies the name and path and reveals a change in the files tree, not the changes tree', async () => {
  setup();
  mockCommand('tree', ({ path }) =>
    path === '' ? [treeEntry('src', true)] : [treeEntry('src/app.ts')],
  );
  const user = userEvent.setup();
  useFilterStore.getState().set(repository.id, 'app');
  useSelection
    .getState()
    .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
  mountApp();
  await user.click(await screen.findByRole('button', { name: /^Files/ }));
  const files = await screen.findByRole('tree', { name: 'All files' });
  await within(files).findByRole('treeitem', { name: 'src' });
  expect(
    within(files).queryByRole('treeitem', { name: 'app.ts' }),
  ).not.toBeInTheDocument();
  await tabMenu(user, 'app.ts');
  await user.click(
    await screen.findByRole('menuitem', { name: 'Copy filename' }),
  );
  expect(calls).toContainEqual({
    command: 'clipboard_write',
    args: { text: 'app.ts' },
  });
  await tabMenu(user, 'app.ts');
  await user.click(await screen.findByRole('menuitem', { name: 'Copy path' }));
  expect(calls).toContainEqual({
    command: 'clipboard_write',
    args: { text: '/fixture/src/app.ts' },
  });
  await revealTab(user, 'app.ts');
  await waitFor(() =>
    expect(
      within(files).getByRole('treeitem', { name: 'app.ts' }),
    ).toHaveFocus(),
  );
  expect(useFilterStore.getState().text[repository.id]).toBe('app');
  expect(useReveal.getState().targets[repository.id]).toBeUndefined();
});

it('opens the files section, clears a hiding filter, and loads folders to reveal a clean file', async () => {
  setup();
  mockCommand('tree', ({ path }) => docsTree(path));
  const user = userEvent.setup();
  useFilterStore.getState().set(repository.id, 'app');
  useSelection
    .getState()
    .select(repository.id, { path: 'docs/guide.md', source: 'file' });
  mountApp();
  await revealTab(user, 'guide.md');
  expect(useLayout.getState().tabs[repository.id].filesOpen).toBe(true);
  expect(useFilterStore.getState().text[repository.id]).toBe('');
  const files = await screen.findByRole('tree', { name: 'All files' });
  await waitFor(() =>
    expect(
      within(files).getByRole('treeitem', { name: 'guide.md' }),
    ).toHaveFocus(),
  );
});

it('gives up on a file the tree no longer lists', async () => {
  setup();
  mockCommand('tree', ({ path }) =>
    path === '' ? [treeEntry('docs', true)] : [],
  );
  const user = userEvent.setup();
  useFilterStore.getState().set(repository.id, 'gone');
  useSelection
    .getState()
    .select(repository.id, { path: 'docs/gone.txt', source: 'file' });
  mountApp();
  await revealTab(user, 'gone.txt');
  expect(useFilterStore.getState().text[repository.id]).toBe('gone');
  await waitFor(() =>
    expect(useReveal.getState().targets[repository.id]).toBeUndefined(),
  );
});

it('reveals a commit file in the commit tree', async () => {
  setup();
  const user = userEvent.setup();
  useLayout.getState().update(repository.id, { mode: 'history' });
  useSelection
    .getState()
    .select(repository.id, {
      path: 'src/app.ts',
      source: 'commit',
      revision: commit.hash,
    });
  mountApp();
  const tree = await screen.findByRole('tree', { name: 'Commit files' });
  await user.click(await within(tree).findByRole('treeitem', { name: 'src' }));
  await revealTab(user, 'app.ts');
  await waitFor(() =>
    expect(
      within(tree).getByRole('treeitem', { name: 'app.ts' }),
    ).toHaveFocus(),
  );
});

it('opens the stash section on the tab stash to reveal a stash file', async () => {
  setup();
  mockCommand('stashes', () => [
    {
      hash: 'stash-hash',
      selector: 'stash@{0}',
      message: 'Saved experiment',
      timestamp: commit.timestamp,
    },
  ]);
  const user = userEvent.setup();
  useSelection
    .getState()
    .select(repository.id, {
      path: 'src/app.ts',
      source: 'stash',
      revision: 'stash-hash',
    });
  mountApp();
  await screen.findByRole('button', { name: /Stashes/ });
  await revealTab(user, 'app.ts');
  expect(useLayout.getState().tabs[repository.id].stashOpen).toBe(true);
  const tree = await screen.findByRole('tree', { name: 'Stash files' });
  await waitFor(() =>
    expect(
      within(tree).getByRole('treeitem', { name: 'app.ts' }),
    ).toHaveFocus(),
  );
});
