import { confirm } from '@tauri-apps/plugin-dialog';
import { perform } from './query';

export interface RevertRequest {
  repo: string;
  paths: string[];
  all?: boolean;
  folder?: string;
}
export async function revertFiles(request: RevertRequest) {
  const { repo, paths, all = false, folder } = request;
  if (!paths.length) return;
  if (
    await confirm(
      `${folder ? `Discard all ${paths.length} changed files in ${folder}` : all ? 'Discard all changed files' : `Discard ${paths[0]}`}? Staged and unstaged changes will be lost. New files will be deleted. This cannot be undone by Git.`,
      {
        title: folder
          ? 'Discard folder'
          : all
            ? 'Discard all changes'
            : 'Discard file',
        kind: 'warning',
      },
    )
  )
    await perform('files_action', {
      repo: repo,
      paths: paths,
      action: 'revert',
    });
}
export async function discardFile(repo: string, path: string) {
  const approved = await confirm(
    `Discard changes to ${path}? These changes cannot be recovered by Git.`,
    { title: 'Discard file', kind: 'warning' },
  );
  if (!approved) return;
  await perform('files_action', {
    repo: repo,
    paths: [path],
    action: 'discard',
  });
}
