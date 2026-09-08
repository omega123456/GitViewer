import { GitCommitHorizontal } from 'lucide-react';
import type { Status } from '../../lib/types';
import { useMessage, useTabs } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { field } from '../shared/styles';
export function CommitFooter({
  repo,
  status,
  disabled,
  commit,
}: {
  repo: string;
  status: Status;
  disabled: boolean;
  commit: () => void;
}) {
  const message = useMessage(repo);
  const staged = status.entries.filter(
    (entry) => entry.index !== '.' && entry.index !== '?',
  ).length;
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-sub p-2 dark:border-line-dark dark:bg-sub-dark">
      <textarea
        aria-label="Commit message"
        placeholder="Commit message"
        rows={2}
        value={message}
        className={`${field} resize-none`}
        onChange={(event) =>
          useTabs.getState().setMessage(repo, event.target.value)
        }
      />
      {status.branch === '(detached)' && (
        <p className="text-label text-modified">
          This commit will be created on detached HEAD.
        </p>
      )}
      <Button
        disabled={disabled}
        className="bg-accent text-white"
        onClick={commit}
      >
        <GitCommitHorizontal className="size-3.5" />
        <span className="truncate">
          Commit {staged} {staged === 1 ? 'file' : 'files'} to {status.branch}
        </span>
      </Button>
    </div>
  );
}
