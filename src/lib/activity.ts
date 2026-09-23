import type { Activity, Progress } from '../stores/activity';
import type { Status } from './types';
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
export function describeActivity(activity: Activity, status: Status) {
  const { args } = activity;
  switch (activity.command) {
    case 'sync':
      if (args.action === 'fetch') return 'Fetching';
      if (args.action === 'pull') return `Pulling from ${status.upstream}`;
      return `Pushing to ${status.upstream ?? status.branch}`;
    case 'commit':
      return 'Committing…';
    case 'stash_save':
      return 'Stashing…';
    case 'stash_apply':
      return args.pop ? 'Popping stash…' : 'Applying stash…';
    case 'stash_drop':
      return 'Dropping stash…';
    case 'branch_switch':
    case 'smart_checkout':
      return `Switching to ${String(args.name)}…`;
    case 'branch_create':
      return `Creating ${String(args.name)}…`;
    case 'branch_delete':
      return `Deleting ${String(args.name)}…`;
    case 'branch_merge':
      return `Merging ${String(args.name)}…`;
    case 'merge_abort':
      return 'Aborting merge…';
    case 'files_action':
    case 'hunk_action':
      return fileVerbs[String(args.action)] ?? null;
    default:
      return null;
  }
}
