import { open, confirm } from '@tauri-apps/plugin-dialog';
import { reportAppError } from './ipc';
import { folderName } from './paths';
import { client, perform, queryKey } from './query';
import type { Repository, Worktree } from './types';
import { unsavedNames } from '../stores/editor';
import { projectWidths, useLayout } from '../stores/layout';
import { announceInfo } from '../stores/successes';
import { projectOf, tabById, useTabs, type Tab } from '../stores/tabs';
export function seedStatus(info: Repository) {
  client.setQueryData(queryKey('status', { repo: info.id }), info.status);
}
export function joinProject(repo: Repository) {
  seedStatus(repo);
  const project = tabById(repo.project);
  if (project && !useLayout.getState().tabs[repo.id])
    useLayout.getState().update(repo.id, projectWidths(project.view));
  useTabs.getState().join(repo.project, folderName(repo.project), repo.id);
}
async function openPicked(path: string) {
  const repo = await perform('repo_open', { path });
  if (!repo) return;
  seedStatus(repo);
  useTabs.getState().open(repo.project, folderName(repo.project), repo.id);
}
export async function openRepository() {
  try {
    const path = await open({
      directory: true,
      multiple: false,
      title: 'Open Git repository',
    });
    if (typeof path === 'string') await openPicked(path);
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
export async function showWorktree(id: string) {
  const tab = projectOf(id);
  if (tab) await switchWorktree(tab, id);
}
export async function syncMembers(id: string, list: Worktree[]) {
  const present = list.filter(
    (worktree) => !worktree.missing && !worktree.bare,
  );
  const tab = tabById(id);
  if (!tab) return;
  const joining = present.filter(
    (worktree) => !tab.members.includes(worktree.id),
  );
  for (const worktree of joining) await joinWorktree(worktree.id);
  const leaving = tab.members.filter(
    (member) => !present.some((worktree) => worktree.id === member),
  );
  for (const member of leaving) await leaveWorktree(tab, member);
}
async function joinWorktree(path: string) {
  const repo = await perform('repo_open', { path });
  if (repo) joinProject(repo);
}
async function leaveWorktree(tab: Tab, member: string) {
  await perform('repo_close', { repo: member });
  useTabs.getState().leave(tab.id, member);
  const shown = tabById(tab.id)?.view;
  const wasShown = member === tab.view;
  if (!wasShown || !shown) return;
  announceInfo(shown, 'worktree-missing', {
    title: `Worktree ${folderName(member)} is missing`,
    description: `Showing ${folderName(shown)}`,
  });
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
async function confirmDiscarding(unsaved: string[]) {
  if (!unsaved.length) return true;
  return confirm(
    `Close this repository and discard ${unsaved.join(' and ')}?`,
    { title: 'Close repository' },
  );
}
async function closeMembers(tab: Tab) {
  for (const member of tab.members) {
    const closed = await perform('repo_close', { repo: member });
    if (closed === undefined) return false;
  }
  return true;
}
export async function closeRepository(tab: Tab) {
  const approved = await confirmDiscarding(unsavedWork(tab));
  if (!approved) return;
  const closed = await closeMembers(tab);
  if (closed) useTabs.getState().close(tab.id);
}
