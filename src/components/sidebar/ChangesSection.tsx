import { memo, useMemo, type ReactNode } from 'react';
import { perform, useBackend } from '../../lib/query';
import { revertFiles } from '../../lib/revert';
import { Button } from '../shared/Button';
import { CheckCircle2, Minus, Plus, SearchX, Trash2 } from 'lucide-react';
import type { Entry, Lines, LineStats, Status } from '../../lib/types';
import { useDeferredFilter } from '../../stores/filter';
import { useSidebarMode } from '../../stores/layout';
import { sumLines } from '../shared/LineCount';
import { State } from '../states/State';
import { ChangesTree, type ChangesContext } from './ChangesTree';
import { groupEntries, inSection } from './nodes';
import { addedInk, discardIcon, iconButton } from '../shared/styles';
import { ViewAllButton } from '../shared/ViewAllButton';

type Stack = 'staged' | 'unstaged';
interface GroupWording {
  title: string;
  viewLabel: string;
  moveLabel: string;
  action: 'stage' | 'unstage';
  moveClass: string;
  moveIcon: ReactNode;
  discardLabel: string;
}
const groupWording: Record<Stack, GroupWording> = {
  staged: {
    title: 'Staged changes',
    viewLabel: 'All staged changes',
    moveLabel: 'Unstage all',
    action: 'unstage',
    moveClass: 'text-modified dark:text-modified-dark',
    moveIcon: <Minus className="size-4" />,
    discardLabel: 'Discard all staged changes',
  },
  unstaged: {
    title: 'Changes',
    viewLabel: 'All changes',
    moveLabel: 'Stage all',
    action: 'stage',
    moveClass: addedInk,
    moveIcon: <Plus className="size-4" />,
    discardLabel: 'Discard all changes',
  },
};
function pathsOf(entries: Entry[]) {
  return entries.map((entry) => entry.path);
}
function GroupActions({
  context,
  stack,
  entries,
}: {
  context: ChangesContext;
  stack: Stack;
  entries: Entry[];
}) {
  const { repo, disabled } = context;
  const wording = groupWording[stack];
  return (
    <>
      <ViewAllButton
        repo={repo}
        stack={stack}
        label={wording.viewLabel}
        look="group"
      />
      <Button
        variant="icon"
        className={`${iconButton} ml-2 ${wording.moveClass}`}
        disabled={disabled}
        aria-label={wording.moveLabel}
        title={wording.moveLabel}
        onClick={() =>
          void perform('files_action', {
            repo: repo,
            paths: pathsOf(entries),
            action: wording.action,
          })
        }
      >
        {wording.moveIcon}
      </Button>
      <Button
        variant="icon"
        className={`${iconButton} ${discardIcon}`}
        disabled={disabled}
        aria-label={wording.discardLabel}
        title={wording.discardLabel}
        onClick={() =>
          void revertFiles({ repo: repo, paths: pathsOf(entries), all: true })
        }
      >
        <Trash2 className="size-4" />
      </Button>
    </>
  );
}
function useGroups(status: Status, filter: string) {
  return useMemo(() => {
    const needle = filter.toLowerCase();
    return {
      visible: status.entries.filter((entry) =>
        entry.path.toLowerCase().includes(needle),
      ),
      conflicts: groupEntries(status, 'conflicts', filter),
      staged: groupEntries(status, 'staged', filter),
      unstaged: groupEntries(status, 'unstaged', filter),
    };
  }, [status, filter]);
}
type Groups = ReturnType<typeof useGroups>;
function sectionPaths(status: Status, group: Stack) {
  return status.entries
    .filter((entry) => inSection(entry, group))
    .map((entry) => entry.path);
}
function useLineTotals(status: Status, lines?: LineStats) {
  return useMemo(
    () => ({
      staged: sumLines(lines?.staged, sectionPaths(status, 'staged')),
      unstaged: sumLines(lines?.unstaged, sectionPaths(status, 'unstaged')),
    }),
    [status, lines],
  );
}
interface GroupLineCounts {
  lines?: LineStats;
  totals: Record<Stack, Lines | undefined>;
}
function useGroupLines(repo: string, status: Status): GroupLineCounts {
  const working = useSidebarMode(repo) === 'working';
  const lines = useBackend(
    'line_stats',
    { repo },
    working && status.entries.length > 0,
  ).data;
  return { lines: lines, totals: useLineTotals(status, lines) };
}
interface GroupsView {
  context: ChangesContext;
  groups: Groups;
  counts: GroupLineCounts;
}
function StackTree({ view, stack }: { view: GroupsView; stack: Stack }) {
  const { context, groups, counts } = view;
  const entries = groups[stack];
  if (entries.length === 0) return null;
  const fill = stack === 'unstaged' || groups.unstaged.length === 0;
  return (
    <ChangesTree
      context={context}
      group={{
        source: stack,
        title: groupWording[stack].title,
        count: entries.length,
        fill: fill,
      }}
      lines={{ files: counts.lines?.[stack], total: counts.totals[stack] }}
      actions={
        <GroupActions context={context} stack={stack} entries={entries} />
      }
    />
  );
}
function ChangeGroups(view: GroupsView) {
  const { context, groups } = view;
  const conflicts = groups.conflicts.length;
  return (
    <>
      {conflicts > 0 && (
        <ChangesTree
          context={context}
          group={{
            source: 'conflicts',
            title: 'Conflicts',
            count: conflicts,
            fill: false,
          }}
          lines={{}}
          actions={null}
        />
      )}
      <StackTree view={view} stack="staged" />
      <StackTree view={view} stack="unstaged" />
    </>
  );
}
function ChangesBody({ context, groups, counts }: GroupsView) {
  if (context.status.entries.length === 0)
    return (
      <State icon={CheckCircle2} title="Working tree is clean">
        Nothing to commit.
      </State>
    );
  if (groups.visible.length === 0)
    return (
      <State icon={SearchX} title="No files match the filter">
        Clear the filter to see every change.
      </State>
    );
  return <ChangeGroups context={context} groups={groups} counts={counts} />;
}
export const ChangesSection = memo(function ChangesSection({
  repo,
  status,
  disabled,
}: {
  repo: string;
  status: Status;
  disabled: boolean;
}) {
  const filter = useDeferredFilter(repo);
  const groups = useGroups(status, filter);
  const counts = useGroupLines(repo, status);
  const context = { repo: repo, status: status, disabled: disabled };
  return (
    <div className="flex min-h-changes-floor flex-1 flex-col">
      <ChangesBody context={context} groups={groups} counts={counts} />
    </div>
  );
});
