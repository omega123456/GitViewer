import { folderName } from './paths';
import type { Activity, Progress } from '../stores/activity';
import type { Commands, Status } from './types';
const phases: Record<string, string> = {
  'Enumerating objects': 'Preparing',
  'Counting objects': 'Counting',
  'Compressing objects': 'Compressing',
  'Writing objects': 'Sending',
  'Receiving objects': 'Receiving',
  'Resolving deltas': 'Finalizing',
};
const progressLine = new RegExp(
  `^(?:remote: )?(${Object.keys(phases).join('|')})(?::\\s+(\\d+)%)?`,
);
export function parseProgress(line: string): Progress | null {
  const match = progressLine.exec(line);
  if (!match) return null;
  return {
    phase: phases[match[1]],
    percent: match[2] === undefined ? undefined : Number(match[2]),
  };
}
const fileVerbs: Record<string, string> = {
  stage: 'Staging…',
  unstage: 'Unstaging…',
  discard: 'Discarding…',
  revert: 'Reverting…',
};
type ActivityArgs = Activity['args'];
type Describer = (args: ActivityArgs, status: Status) => string | null;
function syncing(args: ActivityArgs, status: Status) {
  if (args.action === 'fetch') return 'Fetching';
  if (args.action === 'pull') return `Pulling from ${status.upstream}`;
  return `Pushing to ${status.upstream ?? status.branch}`;
}
function switching(args: ActivityArgs) {
  return `Switching to ${String(args.name)}…`;
}
function changingFiles(args: ActivityArgs) {
  return fileVerbs[String(args.action)] ?? null;
}
const describers: Partial<Record<keyof Commands, Describer>> = {
  sync: syncing,
  commit: () => 'Committing…',
  stash_save: () => 'Stashing…',
  stash_apply: (args) => (args.pop ? 'Popping stash…' : 'Applying stash…'),
  stash_drop: () => 'Dropping stash…',
  branch_switch: switching,
  smart_checkout: switching,
  branch_create: (args) => `Creating ${String(args.name)}…`,
  branch_delete: (args) => `Deleting ${String(args.name)}…`,
  branch_gone: () => 'Checking remote…',
  branch_prune: () => 'Pruning branches…',
  branch_merge: (args) => `Merging ${String(args.name)}…`,
  merge_abort: () => 'Aborting merge…',
  worktree_apply: (args) =>
    args.smart ? 'Stashing and applying…' : 'Applying to main…',
  worktree_unapply: () => 'Undoing apply…',
  worktree_remove: (args) =>
    `Deleting worktree ${folderName(String(args.worktree))}…`,
  files_action: changingFiles,
  hunk_action: changingFiles,
};
export function describeActivity(activity: Activity, status: Status) {
  const describe = describers[activity.command];
  if (!describe) return null;
  return describe(activity.args, status);
}
