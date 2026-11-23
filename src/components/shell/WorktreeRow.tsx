import { useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import {
  ArrowRightFromLine,
  Check,
  FolderGit2,
  FolderSymlink,
  Lock,
  MoreHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useBackend } from '../../lib/query';
import { applyWorktree, deleteWorktree } from '../../lib/worktree';
import type { Status, Worktree } from '../../lib/types';
import { useCurrentActivity } from '../../stores/activity';
import { useErrors } from '../../stores/errors';
import type { Tab } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import {
  errorDot,
  menu,
  menuItem,
  menuSeparator,
  mutedLabel,
  removedInk,
} from '../shared/styles';
import {
  changeCount,
  hasWorktreeMenu,
  isUnreachable,
  worktreeBusyLabel,
  worktreeHead,
  type BranchListContext,
} from './branch-rows';

export function WorktreeIcon({ worktree }: { worktree: Worktree }) {
  const Icon = worktree.main ? FolderGit2 : FolderSymlink;
  return <Icon className="size-3 shrink-0 text-muted dark:text-muted-dark" />;
}
function MissingMarker() {
  return (
    <>
      missing
      <TriangleAlert
        role="img"
        aria-label="Folder missing"
        className="size-3"
      />
    </>
  );
}
function ChangesMarker({ count }: { count: number }) {
  return (
    <>
      <span
        role="img"
        aria-label="Uncommitted changes"
        className="size-2 rounded-full bg-modified dark:bg-modified-dark"
      />
      <span className="font-mono">{count}</span>
    </>
  );
}
function LockedMarker({ reason }: { reason: string }) {
  return (
    <span title={reason || 'Locked'}>
      <Lock role="img" aria-label="Locked" className="size-3" />
    </span>
  );
}
function RunningMarker() {
  return (
    <span role="img" aria-label="Git operation running">
      <Spinner className="size-3 text-accent dark:text-accent-dark" />
    </span>
  );
}
function Marker({
  worktree,
  status,
  busy,
}: {
  worktree: Worktree;
  status?: Status;
  busy?: string;
}) {
  const running = Boolean(useCurrentActivity(worktree.id));
  const failed = useErrors((state) =>
    Boolean(state.scopes[worktree.id]?.length),
  );
  const count = status?.entries.length ?? 0;
  if (busy) return busy;
  if (running) return <RunningMarker />;
  if (worktree.missing) return <MissingMarker />;
  if (failed)
    return <span role="img" aria-label="Errors waiting" className={errorDot} />;
  if (count) return <ChangesMarker count={count} />;
  if (worktree.locked !== null)
    return <LockedMarker reason={worktree.locked} />;
  return null;
}
interface WorktreeMenuContext {
  view: string;
  project: Tab;
  main?: Worktree;
  onPick: () => void;
}
interface WorktreeMenuProps {
  worktree: Worktree;
  context: WorktreeMenuContext;
  changes: number;
  disabled: boolean;
}
function useWorktreeMenu({ worktree, context, changes }: WorktreeMenuProps) {
  const [open, setOpen] = useState(false);
  const target = context.main?.id ?? '';
  const comparable = Boolean(context.main) && !worktree.missing;
  const summary = useBackend(
    'worktree_summary',
    { repo: worktree.id, target: target },
    open && comparable,
  ).data;
  const own = useCurrentActivity(worktree.id);
  const mainActivity = useCurrentActivity(target);
  const unchanged = Boolean(summary) && !summary?.ahead && !changes;
  return {
    open: open,
    setOpen: setOpen,
    target: target,
    busy: Boolean(own || mainActivity),
    empty: unchanged,
  };
}
function ApplyToMainItem({
  worktree,
  context,
  target,
  disabled,
}: {
  worktree: Worktree;
  context: WorktreeMenuContext;
  target: string;
  disabled: boolean;
}) {
  const { main, view, onPick } = context;
  if (!main || worktree.missing) return null;
  return (
    <>
      <DropdownMenu.Item
        disabled={disabled}
        title={`Apply all changes to ${main.name} on ${main.branch}`}
        className={menuItem}
        onSelect={() => {
          onPick();
          void applyWorktree(view, worktree, target);
        }}
      >
        <ArrowRightFromLine className="size-3" />
        Apply to main checkout
      </DropdownMenu.Item>
      <DropdownMenu.Separator className={menuSeparator} />
    </>
  );
}
function WorktreeMenu(props: WorktreeMenuProps) {
  const { worktree, context, changes, disabled } = props;
  const state = useWorktreeMenu(props);
  return (
    <DropdownMenu.Root
      modal={false}
      open={state.open}
      onOpenChange={state.setOpen}
    >
      <DropdownMenu.Trigger asChild>
        <Button aria-label={`Actions for ${worktree.name}`} disabled={disabled}>
          <MoreHorizontal className="size-3 text-muted dark:text-muted-dark" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className={`w-60 ${menu}`}
        >
          <ApplyToMainItem
            worktree={worktree}
            context={context}
            target={state.target}
            disabled={state.busy || state.empty}
          />
          <DropdownMenu.Item
            disabled={state.busy}
            className={`${menuItem} ${removedInk}`}
            onSelect={() => {
              context.onPick();
              void deleteWorktree(context.project, worktree, changes);
            }}
          >
            <Trash2 className="size-3" />
            Delete worktree…
          </DropdownMenu.Item>
          {state.empty && (
            <p className={`px-3.5 pb-1 pl-10.5 ${mutedLabel}`}>
              No changes since it split from main
            </p>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
function WorktreeMenuSlot({
  worktree,
  context,
  busy,
}: {
  worktree: Worktree;
  context: BranchListContext;
  busy?: string;
}) {
  const { project, worktrees } = context;
  const shown = project && hasWorktreeMenu(worktree, worktrees.present);
  if (!shown) return <span aria-hidden className="w-7 shrink-0" />;
  return (
    <WorktreeMenu
      worktree={worktree}
      context={{
        view: context.repo,
        project: project,
        main: worktrees.main,
        onPick: context.close,
      }}
      changes={changeCount(context.statuses, worktree.id)}
      disabled={Boolean(busy)}
    />
  );
}
export function WorktreeRow({
  worktree,
  context,
}: {
  worktree: Worktree;
  context: BranchListContext;
}) {
  const { repo, statuses, activity, go } = context;
  const status = statuses[worktree.id];
  const busy = worktreeBusyLabel(activity, worktree);
  const unavailable = isUnreachable(worktree, repo) || Boolean(busy);
  return (
    <div className="flex h-section items-center">
      <Button
        title={worktree.id}
        disabled={unavailable}
        className="min-w-0 flex-1 justify-start"
        onClick={() => go(worktree)}
      >
        <Check
          className={`size-3 shrink-0 ${worktree.id === repo ? '' : 'opacity-0'}`}
        />
        <WorktreeIcon worktree={worktree} />
        <span className="truncate">{worktree.name}</span>
        <span className="truncate font-mono text-badge text-muted dark:text-muted-dark">
          {worktreeHead(worktree, status)}
        </span>
        <span
          className={`ml-auto flex shrink-0 items-center gap-1.5 ${mutedLabel}`}
        >
          <Marker worktree={worktree} status={status} busy={busy} />
        </span>
      </Button>
      <WorktreeMenuSlot worktree={worktree} context={context} busy={busy} />
    </div>
  );
}
