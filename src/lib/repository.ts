import { open, confirm } from '@tauri-apps/plugin-dialog';
import { reportAppError } from './ipc';
import { client, perform, queryKey } from './query';
import type { Repository, Worktree } from './types';
import { unsavedNames } from '../stores/editor';
import { projectWidths, useLayout } from '../stores/layout';
import { useSuccesses } from '../stores/successes';
import { useTabs, type Tab } from '../stores/tabs';
export function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
export function seedStatus(info: Repository) {
  client.setQueryData(queryKey('status', { repo: info.id }), info.status);
}
export function joinProject(repo: Repository) {
  seedStatus(repo);
  const project = useTabs
    .getState()
    .tabs.find((tab) => tab.id === repo.project);
  if (project && !useLayout.getState().tabs[repo.id])
    useLayout.getState().update(repo.id, projectWidths(project.view));
  useTabs.getState().join(repo.project, folderName(repo.project), repo.id);
}
export async function openRepository() {
  try {
    const path = await open({
      directory: true,
      multiple: false,
      title: 'Open Git repository',
    });
    if (typeof path === 'string') {
      const repo = await perform('repo_open', { path });
      if (repo) {
        seedStatus(repo);
        useTabs
          .getState()
          .open(repo.project, folderName(repo.project), repo.id);
      }
    }
  } catch (error) {
    reportAppError(error);
  }
}
export async function switchWorktree(tab: Tab, id: string) {
  if (!tab.members.includes(id)) {
    const repo = await perform('repo_open', { path: id });
    if (!repo) return;
    joinProject(repo);
  }
  useTabs.getState().show(tab.id, id);
}
export async function syncMembers(id: string, list: Worktree[]) {
  const present = list.filter(
    (worktree) => !worktree.missing && !worktree.bare,
  );
  const tab = useTabs.getState().tabs.find((tab) => tab.id === id);
  if (!tab) return;
  for (const worktree of present)
    if (!tab.members.includes(worktree.id)) {
      const repo = await perform('repo_open', { path: worktree.id });
      if (repo) joinProject(repo);
    }
  for (const member of tab.members)
    if (!present.some((worktree) => worktree.id === member)) {
      await perform('repo_close', { repo: member });
      useTabs.getState().leave(id, member);
      const shown = useTabs.getState().tabs.find((tab) => tab.id === id)?.view;
      if (member === tab.view && shown)
        useSuccesses.getState().announce(shown, {
          key: 'worktree-missing',
          title: `Worktree ${folderName(member)} is missing`,
          description: `Showing ${folderName(shown)}`,
          info: true,
        });
    }
}
function unsavedWork(tab: Tab) {
  const { messages } = useTabs.getState();
  const names = tab.members.flatMap((member) => unsavedNames(member));
  return [
    tab.members.some((member) => messages[member])
      ? 'its unsaved commit message'
      : '',
    names.length ? `unsaved edits to ${names.join(', ')}` : '',
  ].filter(Boolean);
}
export async function closeRepository(tab: Tab) {
  const unsaved = unsavedWork(tab);
  if (
    unsaved.length &&
    !(await confirm(
      `Close this repository and discard ${unsaved.join(' and ')}?`,
      { title: 'Close repository' },
    ))
  )
    return;
  for (const member of tab.members)
    if ((await perform('repo_close', { repo: member })) === undefined) return;
  useTabs.getState().close(tab.id);
}
