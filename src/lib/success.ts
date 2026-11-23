import { shortHash } from './git';
import { folderName } from './paths';
import { plural, pluralWord, truncateList, type ListLayout } from './text';
import type { Applied, Commands, Pruned, Stash, Status } from './types';
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
const NAME_LIST: ListLayout = {
  limit: 5,
  separator: ', ',
  overflowSeparator: ' ',
};
type SyncDescriber = (
  key: string,
  commits: number | null,
  status: Status | undefined,
) => Success;
function upstreamOf(status: Status | undefined) {
  return status?.upstream ?? 'the remote';
}
function fetched(key: string, commits: number | null): Success {
  const success = { key: key, title: 'Fetched' };
  if (commits === null) return success;
  if (!commits) return { ...success, description: 'Up to date', info: true };
  return { ...success, description: plural(commits, 'new commit') };
}
function pulled(
  key: string,
  commits: number | null,
  status: Status | undefined,
): Success {
  const success = { key: key, title: `Pulled from ${upstreamOf(status)}` };
  if (!commits)
    return { ...success, description: 'Already up to date', info: true };
  return { ...success, description: plural(commits, 'commit') };
}
function pushed(
  key: string,
  commits: number | null,
  status: Status | undefined,
): Success {
  const upstream = upstreamOf(status);
  if (commits === null)
    return { key: key, title: `Published ${status?.branch ?? 'branch'}` };
  if (!commits)
    return {
      key: key,
      title: 'Nothing to push',
      description: `${upstream} already has every commit`,
      info: true,
    };
  return {
    key: key,
    replaces: 'commit',
    title: `Pushed to ${upstream}`,
    description: plural(commits, 'commit'),
  };
}
const syncDescribers: Record<string, SyncDescriber> = {
  fetch: fetched,
  pull: pulled,
};
function synced(
  action: string,
  commits: number | null,
  status: Status | undefined,
): Success {
  const describe = syncDescribers[action] ?? pushed;
  return describe(`sync:${action}`, commits, status);
}
export function listNames(names: string[]) {
  return truncateList(names, NAME_LIST);
}
export function localBranches(count: number) {
  return plural(count, 'local branch', 'local branches');
}
function pruned(
  { deleted, kept }: Pruned,
  status: Status | undefined,
): Success {
  const key = 'branch_prune';
  const reason = `Kept ${listNames(kept)}: ${pluralWord(kept.length, 'it has', 'they have')} commits that are not in ${status?.branch ?? 'the current branch'}.`;
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
interface Finished {
  args: Record<string, unknown>;
  result: unknown;
  before: Before;
}
type SuccessDescriber = (finished: Finished) => Success | null;
function nameOf({ args }: Finished) {
  return String(args.name);
}
function stashOf({ args, before }: Finished) {
  return before.stashes?.find((entry) => entry.hash === args.hash);
}
function firstLine(text: string) {
  return text.split('\n')[0];
}
function switched(finished: Finished): Success {
  return { key: 'branch_switch', title: `Switched to ${nameOf(finished)}` };
}
function droppedStash(finished: Finished): Success {
  const stash = stashOf(finished);
  return {
    key: 'stash_drop',
    title: 'Stash dropped',
    description: stash?.message,
    restore: stash && { hash: stash.hash, message: stash.message },
  };
}
function merged(finished: Finished): Success | null {
  if (!finished.result) return null;
  const { status } = finished.before;
  return {
    key: 'branch_merge',
    title: `Merged ${nameOf(finished)}`,
    description: status && `into ${status.branch}`,
  };
}
const successDescribers: Partial<Record<keyof Commands, SuccessDescriber>> = {
  sync: ({ args, result, before }) =>
    synced(
      String(args.action),
      typeof result === 'number' ? result : null,
      before.status,
    ),
  commit: ({ args, result }) => ({
    key: 'commit',
    title: 'Committed',
    description: `${shortHash(String(result))} ${firstLine(String(args.message))}`,
  }),
  stash_save: ({ before }) => ({
    key: 'stash_save',
    title: 'Stashed',
    description: before.status && plural(before.status.entries.length, 'file'),
  }),
  stash_apply: (finished) => ({
    key: 'stash_apply',
    title: finished.args.pop ? 'Stash popped' : 'Stash applied',
    description: stashOf(finished)?.message,
  }),
  stash_drop: droppedStash,
  stash_restore: ({ args }) => ({
    key: 'stash_restore',
    replaces: 'stash_drop',
    title: 'Stash restored',
    description: String(args.message),
  }),
  branch_switch: switched,
  smart_checkout: switched,
  branch_create: (finished) => ({
    key: 'branch_create',
    title: `Created ${nameOf(finished)}`,
  }),
  branch_delete: (finished) => ({
    key: 'branch_delete',
    title: `Deleted ${nameOf(finished)}`,
  }),
  branch_gone: ({ result }) => gone(stringsOf(result)),
  branch_prune: ({ result, before }) =>
    isPruned(result) ? pruned(result, before.status) : null,
  branch_merge: merged,
  worktree_add: ({ result }) => ({
    key: 'worktree_add',
    title: `Created worktree ${folderName(String(result))}`,
  }),
  worktree_remove: ({ args }) => ({
    key: 'worktree_remove',
    title: `Deleted worktree ${folderName(String(args.worktree))}`,
  }),
  worktree_apply: ({ args, result }) =>
    isApplied(result) ? applied(String(args.target), result) : null,
  worktree_unapply: ({ args }) => ({
    key: 'worktree_unapply',
    replaces: 'worktree_apply',
    title: 'Undid apply',
    description: `Changes removed from ${folderName(String(args.target))}`,
  }),
  merge_abort: () => ({ key: 'merge_abort', title: 'Merge aborted' }),
  files_action: ({ args }) =>
    changed(args.action, plural(stringsOf(args.paths).length, 'file')),
  hunk_action: ({ args }) => changed(args.action, String(args.path)),
};
export function describeSuccess(
  command: keyof Commands,
  args: Record<string, unknown>,
  result: unknown,
  before: Before,
): Success | null {
  const describe = successDescribers[command];
  if (!describe) return null;
  return describe({ args: args, result: result, before: before });
}
