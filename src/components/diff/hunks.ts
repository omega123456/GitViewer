import { confirm } from '@tauri-apps/plugin-dialog';
import { perform } from '../../lib/query';
import type { LoadedDiff } from './target';
export interface HunkChange {
  hunk: number;
  action: string;
}
export async function runHunkAction(file: LoadedDiff, change: HunkChange) {
  const { repo, selection, data } = file;
  const { hunk, action } = change;
  if (
    action === 'discard' &&
    !(await confirm(
      'Discard this hunk? These changes cannot be recovered by Git.',
      { title: 'Discard hunk', kind: 'warning' },
    ))
  )
    return;
  await perform('hunk_action', {
    repo: repo,
    path: selection.path,
    source: selection.source,
    hunk: hunk,
    patch: data.patches[hunk],
    action: action,
  });
}
