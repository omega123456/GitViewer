import { confirm } from '@tauri-apps/plugin-dialog';
import { perform } from './query';

export async function revertFiles(
  repo: string,
  paths: string[],
  all = false,
  folder?: string,
) {
  if (!paths.length) return;
  if (
    await confirm(
      `${folder ? `Revert all ${paths.length} changed files in ${folder}` : all ? 'Revert all changed files' : `Revert ${paths[0]}`}? Staged and unstaged changes will be lost. New files will be deleted. This cannot be undone by Git.`,
      {
        title: folder
          ? 'Revert folder'
          : all
            ? 'Revert all changes'
            : 'Revert file',
        kind: 'warning',
      },
    )
  )
    await perform('files_action', { repo, paths, action: 'revert' });
}
