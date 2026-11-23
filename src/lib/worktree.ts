import { confirmAction } from './dialog';
import { invoke, normalizeError } from './ipc';
import { folderName } from './paths';
import { plural, pluralWord } from './text';
import { client, perform, queryKey } from './query';
import type { Success } from './success';
import type { GitError, Worktree, WorktreeSummary } from './types';
import { ask } from '../stores/decision';
import { useErrors } from '../stores/errors';
import { announceInfo, announcer, useSuccesses } from '../stores/successes';
import { anchorOf, tabById, useTabs, type Tab } from '../stores/tabs';
export async function applyWorktree(
  view: string,
  source: Worktree,
  target: string,
) {
  const { withdraw } = useSuccesses.getState();
  const say = announcer(view, 'worktree_apply');
  const args = { repo: view, source: source.id, target: target, smart: false };
  say({
    title: 'Applying to main',
    description: `Copying commits and uncommitted changes from ${source.name}.`,
    pending: true,
  });
  const recover = async (failure: GitError) => {
    withdraw(view, 'worktree_apply');
    if (failure.category !== 'overlap') {
      useErrors.getState().report(view, failure, { command: 'worktree_apply' });
      return;
    }
    if (
      !(await ask(view, {
        slot: 'branch',
        title: `Apply ${source.name} to main?`,
        body: 'You have uncommitted changes in main to these files:',
        paths: failure.message.split('\n').slice(1),
        note: 'GitViewer stashes them, applies, and restores them. If they conflict, it puts main back as it was.',
        confirm: 'Stash and apply',
      }))
    )
      return say({
        title: 'Apply cancelled',
        description: 'Main was not changed.',
      });
    say({
      title: 'Stashing main, then applying',
      description:
        'Main’s own changes come back afterwards. If they conflict, main is put back as it was.',
      pending: true,
    });
    if (
      (await perform('worktree_apply', { ...args, smart: true })) === undefined
    )
      withdraw(view, 'worktree_apply');
  };
  await perform('worktree_apply', args, { recover });
}
export async function unapplyWorktree(
  view: string,
  unapply: NonNullable<Success['unapply']>,
) {
  const { withdraw } = useSuccesses.getState();
  announceInfo(view, 'worktree_unapply', {
    title: 'Undoing apply',
    description: `Removing the applied changes from ${folderName(unapply.target)}.`,
    pending: true,
  });
  if (
    (await perform('worktree_unapply', { repo: view, ...unapply })) ===
    undefined
  )
    withdraw(view, 'worktree_unapply');
}
export function deletion(
  worktree: Worktree,
  summary: WorktreeSummary,
  changes: number,
) {
  const { orphans } = summary;
  const body = [
    orphans
      ? `${plural(orphans, 'commit')} ${pluralWord(orphans, 'is', 'are')} on no branch and will be lost.`
      : '',
    changes ? `Its ${plural(changes, 'uncommitted change')} will be lost.` : '',
    summary.submodules ? 'Its submodules are deleted with it.' : '',
    worktree.missing
      ? `The folder ${worktree.id} is already gone, so only Git’s record of it is removed.`
      : `This deletes the folder ${worktree.id}, including ignored files.`,
    worktree.detached ? '' : `The branch ${worktree.branch} is kept.`,
  ]
    .filter(Boolean)
    .join(' ');
  if (worktree.locked === null)
    return { title: `Delete worktree ${worktree.name}?`, body: body };
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
const FORCE_LOCKED = 2;
const FORCE_DIRTY = 1;
const NO_FORCE = 0;
function removalForce(locked: boolean, dirty: boolean) {
  if (locked) return FORCE_LOCKED;
  if (dirty) return FORCE_DIRTY;
  return NO_FORCE;
}
export async function deleteWorktree(
  tab: Tab,
  worktree: Worktree,
  changes: number,
) {
  const args = { repo: worktree.id, target: anchorOf(tab) };
  let summary: WorktreeSummary = { ahead: 0, orphans: 0, submodules: false };
  try {
    if (!worktree.missing)
      summary = await client.fetchQuery({
        queryKey: queryKey('worktree_summary', args),
        queryFn: () => invoke('worktree_summary', args),
      });
  } catch (error) {
    useErrors.getState().report(tab.view, normalizeError(error));
    return;
  }
  const { title, body } = deletion(worktree, summary, changes);
  if (!(await confirmAction(body, { title: title, okLabel: 'Delete' })))
    return announceInfo(tab.view, 'worktree_remove', {
      title: 'Deletion cancelled',
      description: `Kept worktree ${worktree.name}.`,
    });
  if (tab.view === worktree.id) useTabs.getState().show(tab.id, args.target);
  if ((await perform('repo_close', { repo: worktree.id })) === undefined)
    return;
  useTabs.getState().leave(tab.id, worktree.id);
  const view = tabById(tab.id)?.view ?? args.target;
  const { withdraw } = useSuccesses.getState();
  announceInfo(view, 'worktree_remove', {
    title: `Deleting worktree ${worktree.name}`,
    description:
      'Removing its folder and ignored files. Large folders can take a while.',
    pending: true,
  });
  const dirty = changes > 0 || summary.submodules;
  const removed = await perform('worktree_remove', {
    repo: view,
    worktree: worktree.id,
    force: removalForce(worktree.locked !== null, dirty),
  });
  if (removed === undefined) withdraw(view, 'worktree_remove');
}
