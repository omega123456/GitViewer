import { perform } from '../../lib/query';
import { revertFiles } from '../../lib/revert';
import { Button } from '../shared/Button';
import {
  CheckCircle2,
  Layers,
  Minus,
  Plus,
  SearchX,
  Trash2,
} from 'lucide-react';
import type { Entry, Status } from '../../lib/types';
import { useFilter } from '../../stores/filter';
import { useSelection } from '../../stores/selection';
import { GroupHeader } from '../shared/Section';
import { State } from '../states/State';
import { ChangesTree } from './FileTree';
import { groupEntries } from './nodes';
const iconButton = 'size-6';
const viewTint =
  'text-muted hover:text-ink dark:text-muted-dark dark:hover:text-ink-dark';
const discardTint =
  'text-muted hover:text-deleted dark:text-muted-dark dark:hover:text-deleted-dark';
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
                      variant="icon"
                      className={`${iconButton} ${viewTint}`}
                      aria-label="All staged changes"
                      title="All staged changes"
                      onClick={() =>
                        useSelection.getState().viewAll(repo, 'staged')
                      }
                    >
                      <Layers className="size-4" />
                    </Button>
                    <Button
                      variant="icon"
                      className={`${iconButton} ml-2 text-modified dark:text-modified-dark`}
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
                      <Minus className="size-4" />
                    </Button>
                    <Button
                      variant="icon"
                      className={`${iconButton} ${discardTint}`}
                      disabled={disabled}
                      aria-label="Discard all staged changes"
                      title="Discard all staged changes"
                      onClick={() =>
                        void revertFiles(repo, paths(staged), true)
                      }
                    >
                      <Trash2 className="size-4" />
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
                      variant="icon"
                      className={`${iconButton} ${viewTint}`}
                      aria-label="All changes"
                      title="All changes"
                      onClick={() =>
                        useSelection.getState().viewAll(repo, 'unstaged')
                      }
                    >
                      <Layers className="size-4" />
                    </Button>
                    <Button
                      variant="icon"
                      className={`${iconButton} ml-2 text-added dark:text-added-dark`}
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
                      <Plus className="size-4" />
                    </Button>
                    <Button
                      variant="icon"
                      className={`${iconButton} ${discardTint}`}
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
