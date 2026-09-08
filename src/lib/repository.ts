import { open, confirm } from '@tauri-apps/plugin-dialog';
import { normalizeError } from './ipc';
import { perform } from './query';
import { useTabs, type Tab } from '../stores/tabs';
export async function openRepository() {
  try {
    const path = await open({
      directory: true,
      multiple: false,
      title: 'Open Git repository',
    });
    if (typeof path === 'string') {
      const repo = await perform('repo_open', { path });
      if (repo) useTabs.getState().open(repo.id, repo.name);
    }
  } catch (error) {
    useTabs.getState().setError(normalizeError(error));
  }
}
export async function closeRepository(tab: Tab) {
  if (
    tab.message &&
    !(await confirm(
      'Close this repository and discard its unsaved commit message?',
      { title: 'Close repository' },
    ))
  )
    return;
  if ((await perform('repo_close', { repo: tab.id })) !== undefined)
    useTabs.getState().close(tab.id);
}
