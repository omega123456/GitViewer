import { message } from '@tauri-apps/plugin-dialog';
import { confirmAction } from './dialog';
import { perform } from './query';
import type { MergePreview } from './types';
import { plural, truncateList, type ListLayout } from './text';

export interface MergeFraming {
  title: string;
  lead: string;
}

export interface MergeRequest {
  repo: string;
  name: string;
  current: string;
  framing?: MergeFraming;
}

const branchMergeFraming: MergeFraming = { title: 'Merge branch', lead: '' };

const CONFLICT_LIST: ListLayout = {
  limit: 3,
  separator: '\n',
  overflowSeparator: '\n',
};

function question(preview: MergePreview, request: MergeRequest) {
  const { name, current } = request;
  const { changed, conflicts } = preview;
  if (preview.outcome !== 'conflict')
    return `Merge ${name} into ${current}? GitViewer checked the result: ${plural(changed, 'file changes', 'files change')} and nothing conflicts. This will ${preview.outcome === 'fastForward' ? `fast-forward ${current}.` : `create a merge commit on ${current}.`}`;
  const clean = Math.max(changed - conflicts.length, 0);
  return `Merge ${name} into ${current}? ${plural(clean, 'file merges', 'files merge')} cleanly, ${conflicts.length} will conflict:\n\n${truncateList(conflicts, CONFLICT_LIST)}\n\nGitViewer will stage the clean files and leave the conflicting ones marked in your working tree. You can abort the merge afterwards.`;
}

function framedQuestion(
  framing: MergeFraming,
  preview: MergePreview,
  request: MergeRequest,
) {
  return [framing.lead, question(preview, request)].filter(Boolean).join(' ');
}

export async function mergeBranch(request: MergeRequest) {
  const { repo, name, current, framing = branchMergeFraming } = request;
  const preview = await perform('merge_preview', { repo, name });
  if (!preview) return;
  if (preview.outcome === 'upToDate') {
    await message(`${name} is already merged into ${current}. Nothing to do.`, {
      title: framing.title,
    });
    return;
  }
  const conflicting = preview.outcome === 'conflict';
  if (
    await confirmAction(framedQuestion(framing, preview, request), {
      title: framing.title,
      kind: conflicting ? 'warning' : 'info',
      okLabel: conflicting ? 'Merge anyway' : 'Merge',
    })
  )
    await perform('branch_merge', { repo, name });
}
