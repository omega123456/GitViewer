import { useEffect, useReducer } from 'react';
import { format, formatDistanceToNow, milliseconds, parseISO } from 'date-fns';
import { FolderSymlink, GitBranch } from 'lucide-react';
import { folderName } from '../../lib/paths';
import { useProject } from '../../stores/tabs';
import { describeActivity } from '../../lib/activity';
import type { Status } from '../../lib/types';
import { useCurrentActivity } from '../../stores/activity';
import { Spinner } from '../shared/Spinner';
function useTicks() {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, milliseconds({ seconds: 30 }));
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, []);
}
function LastFetched({ fetched }: { fetched: string | null }) {
  useTicks();
  if (!fetched) return <span>Not fetched yet</span>;
  const at = parseISO(fetched);
  return (
    <span title={`Fetched ${format(at, 'd MMMM yyyy, HH:mm O')}`}>
      Fetched {formatDistanceToNow(at, { addSuffix: true })}
    </span>
  );
}
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
  const project = useProject(repo);
  return (
    <footer className="flex h-status shrink-0 items-center gap-3.5 border-t border-line bg-sub px-2.5 text-label whitespace-nowrap text-muted dark:border-line-dark dark:bg-sub-dark dark:text-muted-dark">
      {project && project.members.length > 1 && (
        <span className="flex items-center gap-1.5">
          <FolderSymlink className="size-3" />
          {folderName(repo)}
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <GitBranch className="size-3" />
        {status.branch === '(detached)'
          ? `${status.oid.slice(0, 7)} detached`
          : status.branch}
      </span>
      {status.upstream && (
        <span className="tabular-nums">
          ↓{status.behind} ↑{status.ahead}
        </span>
      )}
      <span>{status.entries.length} changed</span>
      {(status.upstream || status.fetched) && (
        <LastFetched fetched={status.fetched} />
      )}
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
      <span>git {version}</span>
    </footer>
  );
}
