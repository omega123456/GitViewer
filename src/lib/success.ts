import type { Stash, Status } from './types';
export interface Before {
  status?: Status;
  stashes?: Stash[];
}
export interface Success {
  key: string;
  title: string;
  description?: string;
  replaces?: string;
  restore?: { hash: string; message: string };
}
function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
function synced(
  action: string,
  commits: number | null,
  status: Status | undefined,
): Success {
  const key = `sync:${action}`;
  const upstream = status?.upstream ?? 'the remote';
  if (action === 'fetch')
    return {
      key,
      title: 'Fetched',
      description:
        commits === null
          ? undefined
          : commits
            ? plural(commits, 'new commit')
            : 'Up to date',
    };
  if (action === 'pull')
    return {
      key,
      title: `Pulled from ${upstream}`,
      description: commits ? plural(commits, 'commit') : 'Already up to date',
    };
  if (commits === null)
    return { key, title: `Published ${status?.branch ?? 'branch'}` };
  return commits
    ? {
        key,
        replaces: 'commit',
        title: `Pushed to ${upstream}`,
        description: plural(commits, 'commit'),
      }
    : {
        key,
        title: 'Nothing to push',
        description: `${upstream} already has every commit`,
      };
}
function changed(
  action: unknown,
  description: string | undefined,
): Success | null {
  if (action === 'discard')
    return { key: 'discard', title: 'Discarded changes', description };
  if (action === 'revert')
    return { key: 'revert', title: 'Reverted', description };
  return null;
}
export function describeSuccess(
  command: string,
  args: Record<string, unknown>,
  result: unknown,
  { status, stashes }: Before,
): Success | null {
  const name = String(args.name);
  const stash = stashes?.find((entry) => entry.hash === args.hash);
  switch (command) {
    case 'sync':
      return synced(
        String(args.action),
        typeof result === 'number' ? result : null,
        status,
      );
    case 'commit':
      return {
        key: command,
        title: 'Committed',
        description: `${String(result).slice(0, 7)} ${String(args.message).split('\n')[0]}`,
      };
    case 'stash_save':
      return {
        key: command,
        title: 'Stashed',
        description: status && plural(status.entries.length, 'file'),
      };
    case 'stash_apply':
      return {
        key: command,
        title: args.pop ? 'Stash popped' : 'Stash applied',
        description: stash?.message,
      };
    case 'stash_drop':
      return {
        key: command,
        title: 'Stash dropped',
        description: stash?.message,
        restore: stash && { hash: stash.hash, message: stash.message },
      };
    case 'stash_restore':
      return {
        key: command,
        replaces: 'stash_drop',
        title: 'Stash restored',
        description: String(args.message),
      };
    case 'branch_switch':
    case 'smart_checkout':
      return { key: 'branch_switch', title: `Switched to ${name}` };
    case 'branch_create':
      return { key: command, title: `Created ${name}` };
    case 'branch_delete':
      return { key: command, title: `Deleted ${name}` };
    case 'branch_merge':
      return result
        ? {
            key: command,
            title: `Merged ${name}`,
            description: status && `into ${status.branch}`,
          }
        : null;
    case 'merge_abort':
      return { key: command, title: 'Merge aborted' };
    case 'files_action':
      return changed(
        args.action,
        plural((args.paths as string[]).length, 'file'),
      );
    case 'hunk_action':
      return changed(args.action, String(args.path));
    default:
      return null;
  }
}
