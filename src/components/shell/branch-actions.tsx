import {
  ArrowRightFromLine,
  Eraser,
  FolderPlus,
  FolderSymlink,
  GitBranch,
  GitMerge,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Action } from '../../lib/keyboard';
import { pruneBranches } from '../../lib/prune';
import { applyWorktree, deleteWorktree } from '../../lib/worktree';
import type { Worktree } from '../../lib/types';
import type { Tab } from '../../stores/tabs';
import {
  changeCount,
  isUnreachable,
  type Statuses,
  type WorktreeSet,
} from './branch-rows';

export interface BranchActionContext {
  repo: string;
  branch: string;
  disabled: boolean;
  openList: () => void;
  createBranch: () => void;
  createWorktree: () => void;
}
export function branchActions(context: BranchActionContext): Action[] {
  const { repo, branch, disabled, openList } = context;
  return [
    {
      id: 'branches',
      icon: <GitBranch className="size-3.5" />,
      label: 'Switch branch',
      key: 'Mod+b',
      disabled: disabled,
      run: openList,
    },
    {
      id: 'new-branch',
      icon: <Plus className="size-3.5" />,
      label: 'Create branch',
      key: 'Mod+Shift+b',
      disabled: disabled,
      run: context.createBranch,
    },
    {
      id: 'merge-branch',
      icon: <GitMerge className="size-3.5" />,
      label: 'Merge a branch',
      key: 'Mod+Alt+m',
      disabled: disabled,
      run: openList,
    },
    {
      id: 'delete-branch',
      icon: <Trash2 className="size-3.5" />,
      label: 'Choose branch to delete',
      key: 'Mod+Alt+x',
      disabled: disabled,
      run: openList,
    },
    {
      id: 'prune-branches',
      icon: <Eraser className="size-3.5" />,
      label: 'Prune local branches',
      key: '',
      disabled: disabled,
      run: () => void pruneBranches(repo, branch),
    },
    {
      id: 'new-worktree',
      icon: <FolderPlus className="size-3.5" />,
      label: 'Create worktree…',
      key: '',
      disabled: disabled,
      run: context.createWorktree,
    },
  ];
}

export interface WorktreeActionContext {
  repo: string;
  project?: Tab;
  worktrees: WorktreeSet;
  statuses: Statuses;
  openList: () => void;
  go: (worktree: Worktree) => void;
}
function switchToActions(context: WorktreeActionContext): Action[] {
  return context.worktrees.all
    .filter((worktree) => !isUnreachable(worktree, context.repo))
    .map((worktree) => ({
      id: `worktree:${worktree.id}`,
      icon: <FolderSymlink className="size-3.5" />,
      label: `Switch to worktree ${worktree.name}`,
      key: '',
      run: () => context.go(worktree),
    }));
}
function applyActions(context: WorktreeActionContext): Action[] {
  const { main, present } = context.worktrees;
  if (!main) return [];
  return present.map((worktree) => ({
    id: `apply:${worktree.id}`,
    icon: <ArrowRightFromLine className="size-3.5" />,
    label: `Apply worktree ${worktree.name} to main`,
    key: '',
    run: () => void applyWorktree(context.repo, worktree, main.id),
  }));
}
function deleteActions(context: WorktreeActionContext): Action[] {
  const { project, worktrees } = context;
  const current = worktrees.current;
  if (!project || !current) return [];
  if (!worktrees.present.includes(current)) return [];
  const changes = changeCount(context.statuses, context.repo);
  return [
    {
      id: 'delete-worktree',
      icon: <Trash2 className="size-3.5" />,
      label: 'Delete worktree…',
      key: '',
      run: () => void deleteWorktree(project, current, changes),
    },
  ];
}
export function worktreeActions(context: WorktreeActionContext): Action[] {
  if (!context.worktrees.linked) return [];
  return [
    {
      id: 'worktrees',
      icon: <FolderSymlink className="size-3.5" />,
      label: 'Switch worktree…',
      key: '',
      run: context.openList,
    },
    ...switchToActions(context),
    ...applyActions(context),
    ...deleteActions(context),
  ];
}
