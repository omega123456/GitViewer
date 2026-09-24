import { confirm } from '@tauri-apps/plugin-dialog';
import { perform } from '../../lib/query';
import type { Diff, Selection } from '../../lib/types';
export async function runHunkAction(
  repo: string,
  selection: Selection,
  data: Diff,
  hunk: number,
  action: string,
) {
  if (
    action === 'discard' &&
    !(await confirm(
      'Discard this hunk? These changes cannot be recovered by Git.',
      { title: 'Discard hunk', kind: 'warning' },
    ))
  )
    return;
  await perform('hunk_action', {
    repo,
    path: selection.path,
    source: selection.source,
    hunk,
    patch: data.patches[hunk],
    action,
  });
}
