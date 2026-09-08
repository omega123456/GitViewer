import { GitBranch } from 'lucide-react';
import type { Status } from '../../lib/types';
import { useTabs } from '../../stores/tabs';
export function StatusBar({
  status,
  version,
}: {
  status: Status;
  version: string;
}) {
  const busy = useTabs((s) => s.busy) > 0;
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
      <span className="ml-auto">
        {busy ? 'Git operation in progress…' : 'Ready'}
      </span>
      <span className="font-mono">git {version}</span>
    </footer>
  );
}
