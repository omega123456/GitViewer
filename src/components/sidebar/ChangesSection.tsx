import { CheckCircle2 } from 'lucide-react';
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
