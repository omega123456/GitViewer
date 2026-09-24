import { open, confirm } from '@tauri-apps/plugin-dialog';
import { reportAppError } from './ipc';
import { perform } from './query';
import { useEditor, fileName } from '../stores/editor';
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
    reportAppError(error);
  }
}
function unsavedWork(tab: Tab) {
  const buffer = useEditor.getState().buffers[tab.id];
  return [
    tab.message ? 'its unsaved commit message' : '',
    buffer?.dirty ? `unsaved edits to ${fileName(buffer.path)}` : '',
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
  if ((await perform('repo_close', { repo: tab.id })) !== undefined)
    useTabs.getState().close(tab.id);
}
