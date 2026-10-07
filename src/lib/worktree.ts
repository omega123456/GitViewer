import { confirm } from '@tauri-apps/plugin-dialog';
import { invoke, normalizeError } from './ipc';
import { attempt, client, perform, queryKey } from './query';
import type { Worktree, WorktreeSummary } from './types';
import { ask } from '../stores/decision';
import { useErrors } from '../stores/errors';
import { anchorOf, useTabs, type Tab } from '../stores/tabs';
function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
export async function applyWorktree(
  view: string,
  source: Worktree,
  target: string,
) {
  const args = { repo: view, source: source.id, target, smart: false };
  try {
    await attempt('worktree_apply', args);
    useErrors.getState().resolve(view, 'worktree_apply');
  } catch (error) {
    const failure = normalizeError(error);
    if (failure.category !== 'overlap') {
      useErrors.getState().report(view, failure, { command: 'worktree_apply' });
      return;
    }
    if (
      await ask(view, {
        slot: 'branch',
        title: `Apply ${source.name} to main?`,
        body: 'You have uncommitted changes in main to these files:',
        paths: failure.message.split('\n').slice(1),
        note: 'GitViewer stashes them, applies, and restores them. If they conflict, it puts main back as it was.',
        confirm: 'Stash and apply',
      })
    )
      await perform('worktree_apply', { ...args, smart: true });
  }
}
export function deletion(
  worktree: Worktree,
  summary: WorktreeSummary,
  changes: number,
) {
  const { orphans } = summary;
  const body = [
    orphans
      ? `${plural(orphans, 'commit')} ${orphans === 1 ? 'is' : 'are'} on no branch and will be lost.`
      : '',
    changes ? `Its ${plural(changes, 'uncommitted change')} will be lost.` : '',
    summary.submodules ? 'Its submodules are deleted with it.' : '',
    `This deletes the folder ${worktree.id}, including ignored files.`,
    worktree.detached ? '' : `The branch ${worktree.branch} is kept.`,
  ]
    .filter(Boolean)
    .join(' ');
  if (worktree.locked === null)
    return { title: `Delete worktree ${worktree.name}?`, body };
  return {
    title: `${worktree.name} is locked`,
    body: [
      worktree.locked ? `Reason: “${worktree.locked}”` : '',
      `Delete it anyway? ${body}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
export async function deleteWorktree(
  tab: Tab,
  worktree: Worktree,
  changes: number,
) {
  const args = { repo: worktree.id, target: anchorOf(tab) };
  let summary: WorktreeSummary;
  try {
    summary = await client.fetchQuery({
      queryKey: queryKey('worktree_summary', args),
      queryFn: () => invoke('worktree_summary', args),
    });
  } catch (error) {
    useErrors.getState().report(tab.view, normalizeError(error));
    return;
  }
  const { title, body } = deletion(worktree, summary, changes);
  if (
    !(await confirm(body, {
      title,
      kind: 'warning',
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
    }))
  )
    return;
  if (tab.view === worktree.id) useTabs.getState().show(tab.id, args.target);
  if ((await perform('repo_close', { repo: worktree.id })) === undefined)
    return;
  useTabs.getState().leave(tab.id, worktree.id);
  const view =
    useTabs.getState().tabs.find((entry) => entry.id === tab.id)?.view ??
    args.target;
  await perform('worktree_remove', {
    repo: view,
    worktree: worktree.id,
    force: worktree.locked !== null ? 2 : changes || summary.submodules ? 1 : 0,
  });
}
