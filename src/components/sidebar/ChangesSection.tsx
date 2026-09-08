import { perform } from '../../lib/query';
import { revertFiles } from '../../lib/revert';
import { Button } from '../shared/Button';
import { CheckCircle2, ListChecks, RotateCcw } from 'lucide-react';
import type { Status } from '../../lib/types';
import { useTabLayout } from '../../stores/layout';
import { GroupHeader, Section } from '../shared/Section';
import { dynamic } from '../shared/styles';
import { State } from '../states/State';
import { ChangesTree } from './FileTree';
export function ChangesSection({
  repo,
  status,
  disabled,
}: {
  repo: string;
  status: Status;
  disabled: boolean;
}) {
  const { changesHeight } = useTabLayout(repo);
  const staged = status.entries.filter(
    (entry) => entry.index !== '.' && entry.index !== '?',
  ).length;
  const unstaged = status.entries.filter(
    (entry) => entry.worktree !== '.',
  ).length;
  return (
    <div
      className="flex h-changes min-h-24 flex-col"
      style={dynamic({ '--changes-height': `${changesHeight}%` })}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1 dark:border-line-dark">
        <Button
          disabled={disabled || !unstaged}
          onClick={() =>
            void perform('files_action', {
              repo,
              paths: status.entries
                .filter((entry) => entry.worktree !== '.')
                .map((entry) => entry.path),
              action: 'stage',
            })
          }
        >
          <ListChecks className="size-3.5" /> Stage all
        </Button>
        <Button
          disabled={disabled || !status.entries.length}
          onClick={() =>
            void revertFiles(
              repo,
              status.entries.map((entry) => entry.path),
              true,
            )
          }
        >
          <RotateCcw className="size-3.5" /> Revert all
        </Button>
      </div>
      <Section title="Changes" count={status.entries.length}>
        {status.entries.length === 0 ? (
          <State icon={CheckCircle2} title="Working tree is clean">
            Nothing to commit.
          </State>
        ) : (
          <>
            <GroupHeader title="Staged changes" count={staged} />
            <ChangesTree
              repo={repo}
              status={status}
              source="staged"
              disabled={disabled}
            />
            <GroupHeader title="Changes" count={unstaged} />
            <ChangesTree
              repo={repo}
              status={status}
              source="unstaged"
              disabled={disabled}
            />
          </>
        )}
      </Section>
    </div>
  );
}
