import { GitBranch } from 'lucide-react';
import { describeActivity } from '../../lib/activity';
import type { Status } from '../../lib/types';
import { useCurrentActivity } from '../../stores/activity';
import { Spinner } from '../shared/Spinner';
export function StatusBar({
  repo,
  status,
  version,
}: {
  repo: string;
  status: Status;
  version: string;
}) {
  const activity = useCurrentActivity(repo);
  const label = activity && describeActivity(activity, status);
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-chrome px-3 text-label text-muted dark:border-line-dark dark:bg-chrome-dark">
      <span className="flex items-center gap-1.5">
        <GitBranch className="size-3" />
        {status.branch === '(detached)'
          ? `${status.oid.slice(0, 7)} detached`
          : status.branch}
      </span>
      {status.upstream && (
        <span className="font-mono">
          ↓{status.behind} ↑{status.ahead}
        </span>
      )}
      <span>{status.entries.length} changed</span>
      {label ? (
        <span className="ml-auto flex items-center gap-1.5 text-ink dark:text-ink-dark">
          <Spinner className="size-3" />
          <span role="status">
            {activity.phase ? `${label} · ${activity.phase}` : label}
          </span>
          {activity.percent !== undefined && (
            <span
              role="progressbar"
              aria-label={activity.phase}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={activity.percent}
              className="font-mono text-accent tabular-nums dark:text-accent-dark"
            >
              {activity.percent}%
            </span>
          )}
        </span>
      ) : (
        <span className="ml-auto">Ready</span>
      )}
      <span className="font-mono">git {version}</span>
    </footer>
  );
}
