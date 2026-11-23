import { confirm } from '@tauri-apps/plugin-dialog';
import { perform } from './query';

export interface RevertRequest {
  repo: string;
  paths: string[];
  all?: boolean;
  folder?: string;
}
interface RevertScope {
  paths: string[];
  all: boolean;
  folder?: string;
}
interface RevertWording {
  subject: string;
  title: string;
}
export function revertWording(scope: RevertScope): RevertWording {
  const { paths, all, folder } = scope;
  if (folder)
    return {
      subject: `Discard all ${paths.length} changed files in ${folder}`,
      title: 'Discard folder',
    };
  if (all)
    return {
      subject: 'Discard all changed files',
      title: 'Discard all changes',
    };
  return { subject: `Discard ${paths[0]}`, title: 'Discard file' };
}
export async function revertFiles(request: RevertRequest) {
  const { repo, paths, all = false, folder } = request;
  if (!paths.length) return;
  const wording = revertWording({ paths, all, folder });
  const approved = await confirm(
    `${wording.subject}? Staged and unstaged changes will be lost. New files will be deleted. This cannot be undone by Git.`,
    { title: wording.title, kind: 'warning' },
  );
  if (!approved) return;
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
