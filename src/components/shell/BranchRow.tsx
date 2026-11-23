import { DropdownMenu } from 'radix-ui';
import {
  Check,
  GitCompare,
  GitMerge,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { perform } from '../../lib/query';
import { checkout } from '../../lib/checkout';
import { mergeBranch } from '../../lib/merge';
import type { Branch, Worktree } from '../../lib/types';
import { Button } from '../shared/Button';
import {
  menu,
  menuItem,
  menuSeparator,
  mutedLabel,
  removedInk,
} from '../shared/styles';
import { openCompare } from '../sidebar/CompareSection';
import { holderOf, type BranchListContext } from './branch-rows';
import { WorktreeIcon } from './WorktreeRow';

interface BranchRowProps {
  branch: Branch;
  holder?: Worktree;
  context: BranchListContext;
}
function BranchLocation({ branch, holder }: Omit<BranchRowProps, 'context'>) {
  if (holder)
    return (
      <>
        in {holder.name}
        <WorktreeIcon worktree={holder} />
      </>
    );
  if (branch.remote) return 'remote';
  if (branch.gone)
    return (
      <span className="text-merge-ink dark:text-merge-ink-dark">
        remote deleted
      </span>
    );
  return 'local';
}
function compareWith(context: BranchListContext, branch: Branch) {
  context.close();
  openCompare(context.repo, {
    compareBase: branch.name,
    compareTarget: context.status.branch,
  });
}
function chooseBranch({ branch, holder, context }: BranchRowProps) {
  if (holder) return context.go(holder);
  context.close();
  void checkout(context.repo, branch.name);
}
async function deleteBranch(repo: string, branch: Branch) {
  const approved = await confirm(
    `Delete ${branch.name}? Unmerged commits will be lost.`,
    { title: 'Delete branch', kind: 'warning' },
  );
  if (approved)
    void perform('branch_delete', { repo: repo, name: branch.name });
}
function isProtected({ branch, holder, context }: BranchRowProps) {
  const pinned = branch.current || branch.default || Boolean(holder);
  return context.disabled || pinned;
}
function BranchActions(props: BranchRowProps) {
  const { branch, holder, context } = props;
  const current = context.status.branch;
  return (
    <DropdownMenu.Content align="end" sideOffset={4} className={`w-60 ${menu}`}>
      <DropdownMenu.Item
        disabled={context.disabled || branch.current}
        className={menuItem}
        title={`Merge into ${current}`}
        onSelect={() => {
          context.close();
          void mergeBranch({
            repo: context.repo,
            name: branch.name,
            current: current,
          });
        }}
      >
        <GitMerge className="size-3 shrink-0" />
        <span className="truncate">Merge into {current}</span>
      </DropdownMenu.Item>
      <DropdownMenu.Item
        disabled={branch.current}
        className={menuItem}
        title={`Compare with ${current}`}
        onSelect={() => compareWith(context, branch)}
      >
        <GitCompare className="size-3 shrink-0" />
        <span className="truncate">Compare with {current}</span>
      </DropdownMenu.Item>
      <DropdownMenu.Separator className={menuSeparator} />
      <DropdownMenu.Item
        disabled={isProtected(props)}
        className={`${menuItem} ${removedInk}`}
        onSelect={() => void deleteBranch(context.repo, branch)}
      >
        <Trash2 className="size-3 shrink-0" />
        Delete branch
      </DropdownMenu.Item>
      {holder && (
        <p className={`px-3.5 pb-1 pl-10.5 ${mutedLabel}`}>
          Checked out in {holder.name}
        </p>
      )}
    </DropdownMenu.Content>
  );
}
function BranchMenu(props: BranchRowProps) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button aria-label={`Actions for ${props.branch.name}`}>
          <MoreHorizontal className="size-3 text-muted dark:text-muted-dark" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <BranchActions {...props} />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
export function BranchRow({
  branch,
  context,
}: {
  branch: Branch;
  context: BranchListContext;
}) {
  const holder = holderOf(branch, context.worktrees.all, context.repo);
  const row = { branch: branch, holder: holder, context: context };
  const unavailable = branch.current || Boolean(holder?.missing);
  return (
    <div className="flex h-section items-center">
      <Button
        disabled={context.disabled || unavailable}
        className="min-w-0 flex-1 justify-start"
        onClick={() => chooseBranch(row)}
      >
        <Check className={`size-3 ${branch.current ? '' : 'opacity-0'}`} />
        <span className="truncate">{branch.name}</span>
        {branch.default && (
          <span className="shrink-0 rounded-full border border-line bg-sub px-1.5 text-badge text-muted dark:border-line-dark dark:bg-sub-dark dark:text-muted-dark">
            default
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-label text-muted">
          <BranchLocation branch={branch} holder={holder} />
        </span>
      </Button>
      <Button
        title={`Compare with ${branch.name}`}
        disabled={branch.current}
        onClick={() => compareWith(context, branch)}
      >
        <GitCompare className="size-3 text-muted dark:text-muted-dark" />
      </Button>
      <BranchMenu {...row} />
    </div>
  );
}
