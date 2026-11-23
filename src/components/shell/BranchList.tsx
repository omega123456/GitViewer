import type { ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { Eraser, FolderPlus, Plus, Search } from 'lucide-react';
import { perform } from '../../lib/query';
import { pruneBranches } from '../../lib/prune';
import type { Branch } from '../../lib/types';
import { runs } from '../../stores/activity';
import { Button } from '../shared/Button';
import { BusyIcon } from '../shared/BusyIcon';
import { TextInput } from '../shared/TextInput';
import { VirtualList } from '../shared/VirtualList';
import {
  dynamic,
  flyout,
  quietIcon,
  searchBox,
  searchInput,
} from '../shared/styles';
import { ErrorRetry, type RetryableQuery } from '../states/Errors';
import {
  filteredBranches,
  listRows,
  longestLabel,
  shownWorktrees,
  type BranchListContext,
  type BranchListRow,
} from './branch-rows';
import { BranchRow } from './BranchRow';
import { WorktreeRow } from './WorktreeRow';

const BRANCH_ROW_HEIGHT = 30;
const LOCAL_BRANCHES = 'Local branches';

export interface BranchListProps {
  context: BranchListContext;
  query: RetryableQuery & { data?: Branch[] };
  switching: boolean;
  filter: string;
  onFilter: (filter: string) => void;
  onCreate: () => void;
  onCreateWorktree: () => void;
  onPressInside: () => void;
}
function PruneButton({
  context,
  switching,
}: {
  context: BranchListContext;
  switching: boolean;
}) {
  const checking = runs(context.activity, 'branch_gone');
  return (
    <Button
      title="Check the remote and delete local branches whose remote branch was deleted"
      aria-busy={checking}
      disabled={context.disabled || switching}
      className={`h-5 text-label ${quietIcon}`}
      onClick={() => void pruneBranches(context.repo, context.status.branch)}
    >
      <BusyIcon busy={checking} icon={Eraser} className="size-3" />
      {checking ? 'Checking remote…' : 'Prune'}
    </Button>
  );
}
function HeadingRow({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-group items-center gap-2 px-2">
      <h3 className="flex-1 text-label font-semibold text-muted dark:text-muted-dark">
        {heading}
      </h3>
      {children}
    </div>
  );
}
function ListRow({
  row,
  props,
  tracked,
}: {
  row: BranchListRow;
  props: BranchListProps;
  tracked: boolean;
}) {
  const { context } = props;
  if (row.kind === 'worktree')
    return <WorktreeRow worktree={row.worktree} context={context} />;
  if (row.kind === 'branch')
    return <BranchRow branch={row.branch} context={context} />;
  const prunable = row.heading === LOCAL_BRANCHES && tracked;
  return (
    <HeadingRow heading={row.heading}>
      {prunable && (
        <PruneButton context={context} switching={props.switching} />
      )}
    </HeadingRow>
  );
}
function ListFooter({ props }: { props: BranchListProps }) {
  const { context } = props;
  const prunable = context.worktrees.all.some((worktree) => worktree.prunable);
  return (
    <div className="mt-2 flex gap-1.5 border-t border-line pt-2 dark:border-line-dark">
      <Button
        variant="standard"
        disabled={context.disabled}
        onClick={props.onCreate}
      >
        <Plus className="size-3" />
        New branch
      </Button>
      <Button
        variant="standard"
        disabled={context.disabled}
        onClick={props.onCreateWorktree}
      >
        <FolderPlus className="size-3" />
        New worktree
      </Button>
      {prunable && (
        <Button
          disabled={context.disabled}
          onClick={() =>
            void perform('worktree_prune', { repo: context.anchor })
          }
        >
          <Eraser className="size-3" />
          Prune missing
        </Button>
      )}
    </div>
  );
}
function FilterField({ props }: { props: BranchListProps }) {
  const label = props.context.worktrees.linked
    ? 'Filter worktrees and branches'
    : 'Filter branches';
  return (
    <label className={`mb-2 h-7 ${searchBox}`}>
      <Search className="size-3.5 shrink-0 text-muted dark:text-muted-dark" />
      <TextInput
        aria-label={label}
        className={searchInput}
        placeholder={label}
        value={props.filter}
        onChange={(event) => props.onFilter(event.target.value)}
      />
    </label>
  );
}
export function BranchList(props: BranchListProps) {
  const { context, query, filter } = props;
  const all = query.data ?? [];
  const tracked = all.some((branch) => !branch.remote && branch.upstream);
  const shown = shownWorktrees(context.worktrees, filter);
  const rows = listRows(shown, filteredBranches(all, filter));
  const longest = longestLabel(all, context.worktrees.all);
  return (
    <Popover.Content
      onPointerDownCapture={props.onPressInside}
      align="start"
      style={dynamic({ '--branches-name-width': `${longest}ch` })}
      className={`z-30 flex h-96 w-branches flex-col p-2 ${flyout}`}
    >
      <FilterField props={props} />
      <ErrorRetry label="Could not load branches" query={query} />
      <VirtualList
        label="Branches"
        items={rows}
        height={BRANCH_ROW_HEIGHT}
        render={(row) => <ListRow row={row} props={props} tracked={tracked} />}
      />
      <ListFooter props={props} />
    </Popover.Content>
  );
}
