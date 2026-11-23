import { memo, useMemo } from 'react';
import { perform, useBackend } from '../../lib/query';
import { revertFiles } from '../../lib/revert';
import { Button } from '../shared/Button';
import { CheckCircle2, Minus, Plus, SearchX, Trash2 } from 'lucide-react';
import type { Entry, Status } from '../../lib/types';
import { useDeferredFilter } from '../../stores/filter';
import { useSidebarMode } from '../../stores/layout';
import { sumLines } from '../shared/LineCount';
import { State } from '../states/State';
import { ChangesTree } from './FileTree';
import { groupEntries, inSection } from './nodes';
import { addedInk, discardIcon, iconButton } from '../shared/styles';
import { ViewAllButton } from '../shared/ViewAllButton';
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
  const { visible, conflicts, staged, unstaged } = useMemo(() => {
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
  const lines = useBackend(
    'line_stats',
    { repo },
    useSidebarMode(repo) === 'working' && status.entries.length > 0,
  ).data;
  const totals = useMemo(() => {
    const paths = (group: 'staged' | 'unstaged') =>
      status.entries
        .filter((entry) => inSection(entry, group))
        .map((entry) => entry.path);
    return {
      staged: sumLines(lines?.staged, paths('staged')),
      unstaged: sumLines(lines?.unstaged, paths('unstaged')),
    };
  }, [status, lines]);
  const paths = (entries: Entry[]) => entries.map((entry) => entry.path);
  return (
    <div className="flex min-h-changes-floor flex-1 flex-col">
      {status.entries.length === 0 ? (
        <State icon={CheckCircle2} title="Working tree is clean">
          Nothing to commit.
        </State>
      ) : visible.length === 0 ? (
        <State icon={SearchX} title="No files match the filter">
          Clear the filter to see every change.
        </State>
      ) : (
        <>
          {conflicts.length > 0 && (
            <ChangesTree
              repo={repo}
              status={status}
              source="conflicts"
              disabled={disabled}
              fill={false}
              title="Conflicts"
              count={conflicts.length}
              actions={null}
            />
          )}
          {staged.length > 0 && (
            <ChangesTree
              repo={repo}
              status={status}
              source="staged"
              disabled={disabled}
              fill={unstaged.length === 0}
              title="Staged changes"
              count={staged.length}
              lines={lines?.staged}
              total={totals.staged}
              actions={
                <>
                  <ViewAllButton
                    repo={repo}
                    stack="staged"
                    label="All staged changes"
                    look="group"
                  />
                  <Button
                    variant="icon"
                    className={`${iconButton} ml-2 text-modified dark:text-modified-dark`}
                    disabled={disabled}
                    aria-label="Unstage all"
                    title="Unstage all"
                    onClick={() =>
                      void perform('files_action', {
                        repo: repo,
                        paths: paths(staged),
                        action: 'unstage',
                      })
                    }
                  >
                    <Minus className="size-4" />
                  </Button>
                  <Button
                    variant="icon"
                    className={`${iconButton} ${discardIcon}`}
                    disabled={disabled}
                    aria-label="Discard all staged changes"
                    title="Discard all staged changes"
                    onClick={() => void revertFiles(repo, paths(staged), true)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              }
            />
          )}
          {unstaged.length > 0 && (
            <ChangesTree
              repo={repo}
              status={status}
              source="unstaged"
              disabled={disabled}
              fill
              title="Changes"
              count={unstaged.length}
              lines={lines?.unstaged}
              total={totals.unstaged}
              actions={
                <>
                  <ViewAllButton
                    repo={repo}
                    stack="unstaged"
                    label="All changes"
                    look="group"
                  />
                  <Button
                    variant="icon"
                    className={`${iconButton} ml-2 ${addedInk}`}
                    disabled={disabled}
                    aria-label="Stage all"
                    title="Stage all"
                    onClick={() =>
                      void perform('files_action', {
                        repo: repo,
                        paths: paths(unstaged),
                        action: 'stage',
                      })
                    }
                  >
                    <Plus className="size-4" />
                  </Button>
                  <Button
                    variant="icon"
                    className={`${iconButton} ${discardIcon}`}
                    disabled={disabled}
                    aria-label="Discard all changes"
                    title="Discard all changes"
                    onClick={() =>
                      void revertFiles(repo, paths(unstaged), true)
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              }
            />
          )}
        </>
      )}
    </div>
  );
});
