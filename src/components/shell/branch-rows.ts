import type { Branch, Status, Worktree } from '../../lib/types';
import { isDetached, shortHash } from '../../lib/git';
import { runs, type Activity } from '../../stores/activity';
import type { Tab } from '../../stores/tabs';

const WORKTREE_LABEL_GAP = 2;
export type BranchListRow =
  | { kind: 'heading'; heading: string }
  | { kind: 'worktree'; worktree: Worktree }
  | { kind: 'branch'; branch: Branch };
export type Statuses = Record<string, Status | undefined>;
export interface WorktreeSet {
  all: Worktree[];
  linked: boolean;
  current?: Worktree;
  main?: Worktree;
  present: Worktree[];
}
function isLinkedCheckout(worktree: Worktree) {
  return !worktree.main && !worktree.missing && !worktree.bare;
}
function isMainCheckout(worktree: Worktree) {
  return worktree.main && !worktree.bare;
}
export function worktreeSet(all: Worktree[], repo: string): WorktreeSet {
  return {
    all: all,
    linked: all.length > 1,
    current: all.find((worktree) => worktree.id === repo),
    main: all.find(isMainCheckout),
    present: all.filter(isLinkedCheckout),
  };
}
export function isUnreachable(worktree: Worktree, repo: string) {
  const shown = worktree.id === repo;
  return shown || worktree.missing || worktree.bare;
}
export function hasWorktreeMenu(worktree: Worktree, present: Worktree[]) {
  const orphaned = worktree.missing && !worktree.main;
  return present.includes(worktree) || orphaned;
}
function matchesFilter(text: string, filter: string) {
  return text.toLowerCase().includes(filter.toLowerCase());
}
export function filteredBranches(branches: Branch[], filter: string) {
  return branches.filter((branch) => matchesFilter(branch.name, filter));
}
export function shownWorktrees(worktrees: WorktreeSet, filter: string) {
  if (!worktrees.linked) return [];
  return worktrees.all.filter((worktree) =>
    matchesFilter(`${worktree.name} ${worktree.branch}`, filter),
  );
}
function worktreeLabelLength(worktree: Worktree) {
  return worktree.name.length + worktree.branch.length + WORKTREE_LABEL_GAP;
}
export function longestLabel(branches: Branch[], worktrees: Worktree[]) {
  return [
    ...branches.map((branch) => branch.name.length),
    ...worktrees.map(worktreeLabelLength),
  ].reduce((widest, length) => Math.max(widest, length), 0);
}
function worktreeRows(shown: Worktree[]): BranchListRow[] {
  if (!shown.length) return [];
  return [
    { kind: 'heading', heading: 'Worktrees' },
    ...shown.map((worktree) => ({
      kind: 'worktree' as const,
      worktree: worktree,
    })),
  ];
}
function branchGroupRows(branches: Branch[], remote: boolean): BranchListRow[] {
  const group = branches.filter((branch) => branch.remote === remote);
  if (!group.length) return [];
  return [
    {
      kind: 'heading',
      heading: remote ? 'Remote branches' : 'Local branches',
    },
    ...group.map((branch) => ({ kind: 'branch' as const, branch: branch })),
  ];
}
export function listRows(shown: Worktree[], branches: Branch[]) {
  return [
    ...worktreeRows(shown),
    ...branchGroupRows(branches, false),
    ...branchGroupRows(branches, true),
  ];
}
export function holderOf(branch: Branch, worktrees: Worktree[], repo: string) {
  const elsewhere = branch.worktree && branch.worktree !== repo;
  if (!elsewhere) return undefined;
  return worktrees.find((worktree) => worktree.id === branch.worktree);
}
function headLabel(detached: boolean, oid: string, branch: string) {
  return detached ? `${shortHash(oid)} detached` : branch;
}
export function worktreeHead(worktree: Worktree, status?: Status) {
  if (worktree.bare) return 'bare';
  if (status)
    return headLabel(isDetached(status.branch), status.oid, status.branch);
  return headLabel(worktree.detached, worktree.oid, worktree.branch);
}
export function worktreeBusyLabel(
  activity: Activity | undefined,
  worktree: Worktree,
) {
  if (runs(activity, 'worktree_remove', { worktree: worktree.id }))
    return 'Deleting…';
  if (runs(activity, 'worktree_apply', { source: worktree.id }))
    return 'Applying…';
  return undefined;
}
export function changeCount(statuses: Statuses, id: string) {
  return statuses[id]?.entries.length ?? 0;
}
export interface BranchListContext {
  repo: string;
  status: Status;
  disabled: boolean;
  project?: Tab;
  anchor: string;
  worktrees: WorktreeSet;
  statuses: Statuses;
  activity?: Activity;
  close: () => void;
  go: (worktree: Worktree) => void;
}
