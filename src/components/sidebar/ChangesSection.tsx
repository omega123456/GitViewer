import { perform } from '../../lib/query';
import { revertFiles } from '../../lib/revert';
import { Button } from '../shared/Button';
import {
  CheckCircle2,
  FileDiff,
  RotateCcw,
  SearchX,
  SquareMinus,
  SquarePlus,
} from 'lucide-react';
import type { Entry, Status } from '../../lib/types';
import { useFilter } from '../../stores/filter';
import { useSelection } from '../../stores/selection';
import { GroupHeader } from '../shared/Section';
import { State } from '../states/State';
import { ChangesTree } from './FileTree';
import { groupEntries } from './nodes';
const iconButton = 'size-6 p-0';
export function ChangesSection({
  repo,
  status,
  disabled,
}: {
  repo: string;
  status: Status;
  disabled: boolean;
}) {
  const filter = useFilter(repo);
  const visible = status.entries.filter((entry) =>
    entry.path.toLowerCase().includes(filter.toLowerCase()),
  );
  const staged = groupEntries(status, 'staged', filter);
  const unstaged = groupEntries(status, 'unstaged', filter);
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
          {staged.length > 0 && (
            <>
              <GroupHeader
                title="Staged changes"
                count={staged.length}
                actions={
                  <>
                    <Button
                      className={iconButton}
                      aria-label="View all staged changes"
                      title="View all staged changes"
                      onClick={() =>
                        useSelection.getState().viewAll(repo, 'staged')
                      }
                    >
                      <FileDiff className="size-3.5" />
                    </Button>
                    <Button
                      className={iconButton}
                      disabled={disabled}
                      aria-label="Unstage all"
                      title="Unstage all"
                      onClick={() =>
                        void perform('files_action', {
                          repo,
                          paths: paths(staged),
                          action: 'unstage',
                        })
                      }
                    >
                      <SquareMinus className="size-3.5" />
                    </Button>
                    <Button
                      className={iconButton}
                      disabled={disabled}
                      aria-label="Revert all staged changes"
                      title="Revert all staged changes"
                      onClick={() =>
                        void revertFiles(repo, paths(staged), true)
                      }
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  </>
                }
              />
              <ChangesTree
                repo={repo}
                status={status}
                source="staged"
                disabled={disabled}
                fill={unstaged.length === 0}
              />
            </>
          )}
          {unstaged.length > 0 && (
            <>
              <GroupHeader
                title="Changes"
                count={unstaged.length}
                actions={
                  <>
                    <Button
                      className={iconButton}
                      aria-label="View all changes"
                      title="View all changes"
                      onClick={() =>
                        useSelection.getState().viewAll(repo, 'unstaged')
                      }
                    >
                      <FileDiff className="size-3.5" />
                    </Button>
                    <Button
                      className={iconButton}
                      disabled={disabled}
                      aria-label="Stage all"
                      title="Stage all"
                      onClick={() =>
                        void perform('files_action', {
                          repo,
                          paths: paths(unstaged),
                          action: 'stage',
                        })
                      }
                    >
                      <SquarePlus className="size-3.5" />
                    </Button>
                    <Button
                      className={iconButton}
                      disabled={disabled}
                      aria-label="Revert all changes"
                      title="Revert all changes"
                      onClick={() =>
                        void revertFiles(repo, paths(unstaged), true)
                      }
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  </>
                }
              />
              <ChangesTree
                repo={repo}
                status={status}
                source="unstaged"
                disabled={disabled}
                fill
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
