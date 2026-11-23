import { shortHash } from './git';
import { folderName } from './paths';
import type { Applied, Pruned, Stash, Status } from './types';
export interface Before {
  status?: Status;
  stashes?: Stash[];
}
export interface Success {
  key: string;
  title: string;
  description?: string;
  info?: true;
  warning?: true;
  pending?: true;
  replaces?: string;
  restore?: { hash: string; message: string };
  unapply?: { target: string; base: string; tree: string };
  show?: string;
}
const LISTED_NAMES = 5;
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
      key: key,
      title: 'Fetched',
      ...(commits === null
        ? {}
        : commits
          ? { description: plural(commits, 'new commit') }
          : { description: 'Up to date', info: true }),
    };
  if (action === 'pull')
    return {
      key: key,
      title: `Pulled from ${upstream}`,
      ...(commits
        ? { description: plural(commits, 'commit') }
        : { description: 'Already up to date', info: true }),
    };
  if (commits === null)
    return { key: key, title: `Published ${status?.branch ?? 'branch'}` };
  return commits
    ? {
        key: key,
        replaces: 'commit',
        title: `Pushed to ${upstream}`,
        description: plural(commits, 'commit'),
      }
    : {
        key: key,
        title: 'Nothing to push',
        description: `${upstream} already has every commit`,
        info: true,
      };
}
export function listNames(names: string[]) {
  const shown = names.slice(0, LISTED_NAMES).join(', ');
  const hidden = names.length - LISTED_NAMES;
  return hidden > 0 ? `${shown} and ${hidden} more` : shown;
}
export function localBranches(count: number) {
  return `${count} local branch${count === 1 ? '' : 'es'}`;
}
function pruned(
  { deleted, kept }: Pruned,
  status: Status | undefined,
): Success {
  const key = 'branch_prune';
  const reason = `Kept ${listNames(kept)}: ${kept.length === 1 ? 'it has' : 'they have'} commits that are not in ${status?.branch ?? 'the current branch'}.`;
  if (!deleted.length)
    return {
      key: key,
      title: 'No branches pruned',
      description: reason,
      info: true,
    };
  if (kept.length)
    return {
      key: key,
      title: `Pruned ${deleted.length} of ${localBranches(deleted.length + kept.length)}`,
      description: reason,
    };
  return {
    key: key,
    title: `Pruned ${localBranches(deleted.length)}`,
    description: listNames(deleted),
  };
}
function applied(target: string, result: Applied): Success {
  const key = 'worktree_apply';
  if (!result.files)
    return {
      key: key,
      title: 'Nothing to apply',
      description: 'No changes since it split from main',
      info: true,
    };
  if (result.conflicts)
    return {
      key: key,
      title: `Applied to main with ${plural(result.conflicts, 'conflict')}`,
      description: 'Resolve them in GitViewer before committing.',
      warning: true,
      show: target,
    };
  return {
    key: key,
    title: 'Applied to main',
    description: `${plural(result.files, 'file')} changed in ${folderName(target)}.`,
    unapply: { target: target, base: result.base, tree: result.tree },
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function stringsOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
function isPruned(value: unknown): value is Pruned {
  return (
    isRecord(value) && Array.isArray(value.deleted) && Array.isArray(value.kept)
  );
}
function isApplied(value: unknown): value is Applied {
  return isRecord(value) && typeof value.files === 'number';
}
function gone(names: string[]): Success {
  if (!names.length)
    return {
      key: 'branch_prune',
      title: 'No branches to prune',
      description: 'Every local branch still has its remote branch.',
      info: true,
    };
  return {
    key: 'branch_prune',
    title: `Found ${localBranches(names.length)} to prune`,
    description: listNames(names),
    info: true,
  };
}
function changed(
  action: unknown,
  description: string | undefined,
): Success | null {
  if (action === 'discard')
    return {
      key: 'discard',
      title: 'Discarded changes',
      description: description,
    };
  if (action === 'revert')
    return { key: 'revert', title: 'Reverted', description: description };
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
        description: `${shortHash(String(result))} ${String(args.message).split('\n')[0]}`,
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
    case 'branch_gone':
      return gone(stringsOf(result));
    case 'branch_prune':
      return isPruned(result) ? pruned(result, status) : null;
    case 'branch_merge':
      return result
        ? {
            key: command,
            title: `Merged ${name}`,
            description: status && `into ${status.branch}`,
          }
        : null;
    case 'worktree_add':
      return {
        key: command,
        title: `Created worktree ${folderName(String(result))}`,
      };
    case 'worktree_remove':
      return {
        key: command,
        title: `Deleted worktree ${folderName(String(args.worktree))}`,
      };
    case 'worktree_apply':
      return isApplied(result) ? applied(String(args.target), result) : null;
    case 'worktree_unapply':
      return {
        key: command,
        replaces: 'worktree_apply',
        title: 'Undid apply',
        description: `Changes removed from ${folderName(String(args.target))}`,
      };
    case 'merge_abort':
      return { key: command, title: 'Merge aborted' };
    case 'files_action':
      return changed(args.action, plural(stringsOf(args.paths).length, 'file'));
    case 'hunk_action':
      return changed(args.action, String(args.path));
    default:
      return null;
  }
}
