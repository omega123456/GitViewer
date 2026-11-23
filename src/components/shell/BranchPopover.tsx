import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { flushSync } from 'react-dom';
import { Popover } from 'radix-ui';
import {
  ChevronDown,
  FolderGit2,
  FolderSymlink,
  GitBranch,
} from 'lucide-react';
import { useActions } from '../../lib/actions';
import { useFormState } from '../../lib/form-state';
import { useBackend, useStatuses } from '../../lib/query';
import { switchWorktree } from '../../lib/repository';
import { isDetached, shortHash, scopeKey } from '../../lib/git';
import type { Status, Worktree } from '../../lib/types';
import { runs, useCurrentActivity } from '../../stores/activity';
import { useErrors } from '../../stores/errors';
import { anchorOf, useProject, type Tab } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { BusyIcon } from '../shared/BusyIcon';
import { Decision } from '../shared/Decision';
import { branchActions, worktreeActions } from './branch-actions';
import { worktreeSet, type Statuses, type WorktreeSet } from './branch-rows';
import { BranchList } from './BranchList';
import { closedBranchForm, CreateBranchDialog } from './CreateBranchDialog';
import { NewWorktree } from './NewWorktree';

const branchCommands = [
  'branch_switch',
  'smart_checkout',
  'branch_create',
  'branch_delete',
  'branch_gone',
  'branch_prune',
  'branch_merge',
  'worktree_apply',
  'worktree_unapply',
  'worktree_remove',
] as const;

function useOutsideDismiss(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
) {
  const pressedInside = useRef(false);
  useEffect(() => {
    if (!open) return;
    pressedInside.current = false;
    const dismiss = () => {
      if (!pressedInside.current) setOpen(false);
      pressedInside.current = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, setOpen]);
  return () => {
    pressedInside.current = true;
  };
}
function branchLabel(status: Status) {
  if (isDetached(status.branch)) return `${shortHash(status.oid)} · detached`;
  return status.branch || 'Branch';
}
function CurrentWorktree({ worktrees }: { worktrees: WorktreeSet }) {
  const { linked, current } = worktrees;
  if (!linked || !current) return null;
  const Icon = current.main ? FolderGit2 : FolderSymlink;
  return (
    <>
      <Icon className="size-4 text-muted dark:text-muted-dark" />
      <span className="max-w-28 truncate">{current.name}</span>
      <span className="text-muted dark:text-muted-dark">/</span>
    </>
  );
}
interface OtherWorktrees {
  repo: string;
  members: string[];
  statuses: Statuses;
}
function useOthersState({ repo, members, statuses }: OtherWorktrees) {
  const others = members.filter((member) => member !== repo);
  const failed = useErrors((state) =>
    others.some((member) => state.scopes[member]?.length),
  );
  const dirty = others.some((member) => statuses[member]?.entries.length);
  return { failed: failed, dirty: dirty };
}
function OthersBadge({ others }: { others: OtherWorktrees }) {
  const { failed, dirty } = useOthersState(others);
  if (!failed && !dirty) return null;
  return (
    <span
      role="img"
      aria-label={
        failed
          ? 'Errors waiting in another worktree'
          : 'Another worktree has uncommitted changes'
      }
      className={`pointer-events-none absolute -top-0.5 -right-0.5 size-1.5 rounded-full ${failed ? 'bg-error-ink dark:bg-error-ink-dark' : 'bg-modified dark:bg-modified-dark'}`}
    />
  );
}
function BranchTrigger({
  status,
  switching,
  worktrees,
  others,
  onPressInside,
}: {
  status: Status;
  switching: boolean;
  worktrees: WorktreeSet;
  others: OtherWorktrees;
  onPressInside: () => void;
}) {
  return (
    <span className="relative flex" onPointerDownCapture={onPressInside}>
      <Popover.Trigger asChild>
        <Button aria-busy={switching} variant="standard" className="h-8">
          <CurrentWorktree worktrees={worktrees} />
          <BusyIcon busy={switching} icon={GitBranch} />
          {branchLabel(status)}
          <ChevronDown className="size-3 text-muted dark:text-muted-dark" />
        </Button>
      </Popover.Trigger>
      {worktrees.linked && <OthersBadge others={others} />}
      <Decision repo={others.repo} slot="branch" className="inset-0" />
    </span>
  );
}
function useWorktrees(repo: string, project?: Tab) {
  const anchor = project ? anchorOf(project) : repo;
  const query = useBackend('worktrees', { repo: anchor });
  return { anchor: anchor, worktrees: worktreeSet(query.data ?? [], repo) };
}
interface BranchPopoverProps {
  repo: string;
  status: Status;
  disabled: boolean;
}
function useBranchState(repo: string) {
  const [open, setOpen] = useState(false);
  const markPressedInside = useOutsideDismiss(open, setOpen);
  const project = useProject(repo);
  const members = project?.members ?? [repo];
  const located = useWorktrees(repo, project);
  const activity = useCurrentActivity(repo);
  const [filter, setFilter] = useState('');
  const branchForm = useFormState(closedBranchForm);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const listed = open || branchForm.form.creating;
  return {
    open: open,
    setOpen: setOpen,
    markPressedInside: markPressedInside,
    project: project,
    members: members,
    anchor: located.anchor,
    worktrees: located.worktrees,
    statuses: useStatuses(members),
    activity: activity,
    switching: branchCommands.some((command) => runs(activity, command)),
    filter: filter,
    setFilter: setFilter,
    branchForm: branchForm,
    creatingWorktree: creatingWorktree,
    setCreatingWorktree: setCreatingWorktree,
    query: useBackend('branches', { repo }, listed),
  };
}
type BranchState = ReturnType<typeof useBranchState>;
function useBranchControls(state: BranchState) {
  const close = () => state.setOpen(false);
  return {
    close: close,
    openList: () => state.setOpen(true),
    createBranch: () => state.branchForm.update({ creating: true }),
    createWorktree: () => state.setCreatingWorktree(true),
    go: (worktree: Worktree) => {
      flushSync(close);
      if (state.project) void switchWorktree(state.project, worktree.id);
    },
  };
}
type BranchControls = ReturnType<typeof useBranchControls>;
function useBranchCommands(
  props: BranchPopoverProps,
  state: BranchState,
  controls: BranchControls,
) {
  const { repo } = props;
  useActions(
    scopeKey(repo, 'branches'),
    branchActions({
      repo: repo,
      branch: props.status.branch,
      disabled: props.disabled,
      openList: controls.openList,
      createBranch: controls.createBranch,
      createWorktree: controls.createWorktree,
    }),
  );
  useActions(
    scopeKey(repo, 'worktrees'),
    worktreeActions({
      repo: repo,
      project: state.project,
      worktrees: state.worktrees,
      statuses: state.statuses,
      openList: controls.openList,
      go: controls.go,
    }),
  );
}
function BranchFlyout({
  props,
  state,
  controls,
}: {
  props: BranchPopoverProps;
  state: BranchState;
  controls: BranchControls;
}) {
  return (
    <Popover.Portal>
      <BranchList
        context={{
          ...props,
          project: state.project,
          anchor: state.anchor,
          worktrees: state.worktrees,
          statuses: state.statuses,
          activity: state.activity,
          close: controls.close,
          go: controls.go,
        }}
        query={state.query}
        switching={state.switching}
        filter={state.filter}
        onFilter={state.setFilter}
        onCreate={() => {
          controls.close();
          controls.createBranch();
        }}
        onCreateWorktree={() => {
          controls.close();
          controls.createWorktree();
        }}
        onPressInside={state.markPressedInside}
      />
    </Popover.Portal>
  );
}
export function BranchPopover(props: BranchPopoverProps) {
  const { repo, status, disabled } = props;
  const state = useBranchState(repo);
  const controls = useBranchControls(state);
  useBranchCommands(props, state, controls);
  return (
    <>
      <Popover.Root open={state.open} onOpenChange={state.setOpen}>
        <BranchTrigger
          status={status}
          switching={state.switching}
          worktrees={state.worktrees}
          others={{
            repo: repo,
            members: state.members,
            statuses: state.statuses,
          }}
          onPressInside={state.markPressedInside}
        />
        <BranchFlyout props={props} state={state} controls={controls} />
      </Popover.Root>
      <CreateBranchDialog
        repo={repo}
        disabled={disabled}
        form={state.branchForm}
        branches={state.query.data ?? []}
      />
      <NewWorktree
        repo={repo}
        project={state.project}
        open={state.creatingWorktree}
        disabled={disabled}
        onOpenChange={state.setCreatingWorktree}
      />
    </>
  );
}
