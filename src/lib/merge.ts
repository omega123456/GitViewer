import { confirm, message } from '@tauri-apps/plugin-dialog';
import { perform } from './query';
import type { MergePreview } from './types';

function listPaths(conflicts: string[]) {
  const shown = conflicts.slice(0, 3).join('\n');
  return conflicts.length > 3
    ? `${shown}\nand ${conflicts.length - 3} more`
    : shown;
}

function question(preview: MergePreview, name: string, current: string) {
  const { changed, conflicts } = preview;
  if (preview.outcome !== 'conflict')
    return `Merge ${name} into ${current}? GitViewer checked the result: ${changed} ${changed === 1 ? 'file changes' : 'files change'} and nothing conflicts. This will ${preview.outcome === 'fastForward' ? `fast-forward ${current}.` : `create a merge commit on ${current}.`}`;
  const clean = Math.max(changed - conflicts.length, 0);
  return `Merge ${name} into ${current}? ${clean} ${clean === 1 ? 'file merges' : 'files merge'} cleanly, ${conflicts.length} will conflict:\n\n${listPaths(conflicts)}\n\nGitViewer will stage the clean files and leave the conflicting ones marked in your working tree. You can abort the merge afterwards.`;
}

export async function mergeBranch(repo: string, name: string, current: string) {
  const preview = await perform('merge_preview', { repo, name });
  if (!preview) return;
  if (preview.outcome === 'upToDate') {
    await message(`${name} is already merged into ${current}. Nothing to do.`, {
      title: 'Merge branch',
    });
    return;
  }
  const conflicting = preview.outcome === 'conflict';
  if (
    await confirm(question(preview, name, current), {
      title: 'Merge branch',
      kind: conflicting ? 'warning' : 'info',
      okLabel: conflicting ? 'Merge anyway' : 'Merge',
      cancelLabel: 'Cancel',
    })
  )
    await perform('branch_merge', { repo, name });
}
