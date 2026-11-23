import { useEffect, useState } from 'react';
import { format, formatDistanceToNow, milliseconds, parseISO } from 'date-fns';
import { FolderSymlink, GitBranch } from 'lucide-react';
import { folderName } from '../../lib/paths';
import { useProject } from '../../stores/tabs';
import { describeActivity } from '../../lib/activity';
import type { Status } from '../../lib/types';
import { useCurrentActivity } from '../../stores/activity';
import { Spinner } from '../shared/Spinner';
import { isDetached, shortHash } from '../../lib/git';
const RELATIVE_TIME_REFRESH = milliseconds({ seconds: 30 });
function useRerenderPeriodically() {
  const [, setRenders] = useState(0);
  useEffect(() => {
    const tick = () => setRenders((count) => count + 1);
    const timer = setInterval(tick, RELATIVE_TIME_REFRESH);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, []);
}
function LastFetched({ fetched }: { fetched: string | null }) {
  useRerenderPeriodically();
  if (!fetched) return <span>Not fetched yet</span>;
  const fetchedAt = parseISO(fetched);
  return (
    <span title={`Fetched ${format(fetchedAt, 'd MMMM yyyy, HH:mm O')}`}>
      Fetched {formatDistanceToNow(fetchedAt, { addSuffix: true })}
    </span>
  );
}
type CurrentActivity = NonNullable<ReturnType<typeof useCurrentActivity>>;
function ActivityProgress({ activity }: { activity: CurrentActivity }) {
  if (activity.percent === undefined) return null;
  return (
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
  );
}
function ActivityStatus({ repo, status }: { repo: string; status: Status }) {
  const activity = useCurrentActivity(repo);
  const label = activity && describeActivity(activity, status);
  if (!label) return <span className="ml-auto">Ready</span>;
  return (
    <span className="ml-auto flex items-center gap-1.5 text-ink dark:text-ink-dark">
      <Spinner className="size-3" />
      <span role="status">
        {activity.phase ? `${label} · ${activity.phase}` : label}
      </span>
      <ActivityProgress activity={activity} />
    </span>
  );
}
function WorktreeFolder({ repo }: { repo: string }) {
  const project = useProject(repo);
  const linked = project && project.members.length > 1;
  if (!linked) return null;
  return (
    <span className="flex items-center gap-1.5">
      <FolderSymlink className="size-3" />
      {folderName(repo)}
    </span>
  );
}
function headName(status: Status) {
  if (isDetached(status.branch)) return `${shortHash(status.oid)} detached`;
  return status.branch;
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
  const fetchable = status.upstream || status.fetched;
  return (
    <footer className="flex h-status shrink-0 items-center gap-3.5 border-t border-line bg-sub px-2.5 text-label whitespace-nowrap text-muted dark:border-line-dark dark:bg-sub-dark dark:text-muted-dark">
      <WorktreeFolder repo={repo} />
      <span className="flex items-center gap-1.5">
        <GitBranch className="size-3" />
        {headName(status)}
      </span>
      {status.upstream && (
        <span className="tabular-nums">
          ↓{status.behind} ↑{status.ahead}
        </span>
      )}
      <span>{status.entries.length} changed</span>
      {fetchable && <LastFetched fetched={status.fetched} />}
      <ActivityStatus repo={repo} status={status} />
      <span>git {version}</span>
    </footer>
  );
}
