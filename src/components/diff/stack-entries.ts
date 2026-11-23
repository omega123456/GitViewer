import type { Comparison, Diff, Selection, Status } from '../../lib/types';
import type { Stack } from '../../stores/selection';
import { UNTRACKED } from '../../lib/git';
import { groupEntries, treeOrder } from '../sidebar/nodes';
import { diffRows } from './rows';
import { lineKey, type Located } from './find';
export interface StackEntry {
  selection: Selection;
  badge?: string;
}
function commitEntries(
  commit: Selection | undefined,
  statuses: Record<string, string>,
): StackEntry[] {
  if (!commit) return [];
  return Object.entries(statuses).map(([path, badge]) => ({
    selection: { ...commit, path },
    badge: badge,
  }));
}
function compareEntries(compared: Comparison | undefined): StackEntry[] {
  if (!compared) return [];
  return compared.files.map((file) => ({
    selection: {
      path: file.path,
      source: 'compare' as const,
      base: compared.base,
      revision: compared.target,
    },
    badge: file.status,
  }));
}
function workingSource(stack: 'staged' | 'unstaged', indexStatus: string) {
  if (stack === 'staged') return 'staged' as const;
  if (indexStatus === UNTRACKED) return 'file' as const;
  return 'unstaged' as const;
}
export function stackEntries({
  stack,
  commit,
  commitStatuses,
  compared,
  status,
  filter,
}: {
  stack: Stack;
  commit: Selection | undefined;
  commitStatuses: Record<string, string>;
  compared: Comparison | undefined;
  status: Status;
  filter: string;
}): StackEntry[] {
  if (stack === 'commit') return commitEntries(commit, commitStatuses);
  if (stack === 'compare') return compareEntries(compared);
  return groupEntries(status, stack, filter).map((entry) => ({
    selection: {
      path: entry.path,
      source: workingSource(stack, entry.index),
    },
    badge: stack === 'staged' ? entry.index : entry.worktree,
  }));
}
export function orderEntries(entries: StackEntry[]): StackEntry[] {
  const byPath = new Map(entries.map((entry) => [entry.selection.path, entry]));
  return treeOrder([...byPath.keys()]).flatMap(
    (path) => byPath.get(path) ?? [],
  );
}
export function comparisonTotals(compared: Comparison | undefined) {
  return (compared?.files ?? []).reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}
export function searchableLines(
  ordered: StackEntry[],
  files: Record<string, Diff> | undefined,
): Located[] {
  if (!files) return [];
  return ordered.flatMap(({ selection }): Located[] => {
    const data = files[selection.path];
    if (!data) return [];
    return diffRows(data, false).flatMap(({ right }) => {
      if (!right) return [];
      return [
        { path: selection.path, key: lineKey(right), content: right.content },
      ];
    });
  });
}
