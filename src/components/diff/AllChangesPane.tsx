import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { useBackend } from '../../lib/query';
import type { Diff, Selection, Settings, Status } from '../../lib/types';
import { groupEntries } from '../sidebar/nodes';
import { useDiffView } from '../../stores/diff-view';
import { useFilter } from '../../stores/filter';
import type { Stack } from '../../stores/selection';
import { focus } from '../shared/styles';
import { State } from '../states/State';
import { StatusBadge } from '../sidebar/StatusBadge';
import { ImageDiff } from '../image/ImageDiff';
import { DiffSourcePill } from './DiffSourcePill';
import { DiffSurface } from './DiffSurface';
import { runHunkAction } from './hunks';
import { diffRows } from './rows';
import { useTokens } from './tokens';
const context = 3;
function note(data: Diff | undefined, error: Error | null) {
  if (error) return error.message;
  if (!data) return 'Loading…';
  if (data.tooLarge) return 'File too large to diff. Select it to view anyway.';
  if (data.binary) return 'Binary file.';
  if (!data.image && data.content === null && data.hunks.length === 0)
    return 'No content change.';
  return null;
}
const titles = {
  staged: 'Staged changes',
  unstaged: 'Changes',
  commit: 'Commit',
};
const labels = {
  staged: 'All staged changes',
  unstaged: 'All changes',
  commit: 'All changes in commit',
};
export function AllChangesPane({
  repo,
  stack,
  commit,
  status,
  settings,
  disabled,
}: {
  repo: string;
  stack: Stack;
  commit?: Selection;
  status: Status;
  settings: Settings;
  disabled: boolean;
}) {
  const filter = useFilter(repo);
  const files = useBackend(
    'commit_files',
    { repo, revision: commit?.revision ?? '', source: commit?.source },
    stack === 'commit',
  );
  const entries =
    stack === 'commit'
      ? (files.data ?? []).map((path) => ({
          selection: { ...commit!, path },
          badge: undefined,
        }))
      : groupEntries(status, stack, filter).map((entry) => ({
          selection: {
            path: entry.path,
            source:
              stack === 'staged'
                ? ('staged' as const)
                : entry.index === '?'
                  ? ('file' as const)
                  : ('unstaged' as const),
          },
          badge: stack === 'staged' ? entry.index : entry.worktree,
        }));
  const scroller = useRef<HTMLDivElement>(null);
  const [, relayout] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(() => relayout((n) => n + 1));
    if (scroller.current) observer.observe(scroller.current.firstElementChild!);
    return () => observer.disconnect();
  }, []);
  return (
    <section
      className="flex h-full min-w-0 flex-col"
      aria-label={labels[stack]}
    >
      <header className="flex h-tab shrink-0 items-center gap-2 border-b border-line px-3 text-sm dark:border-line-dark">
        <span className="font-semibold">{titles[stack]}</span>
        {commit?.revision && (
          <span className="font-mono text-label text-muted">
            {commit.revision.slice(0, 7)}
          </span>
        )}
        <span className="font-mono text-label text-muted">
          {entries.length}
        </span>
      </header>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div>
          {files.error ? (
            <State title="Unable to list commit files">
              {files.error.message}
            </State>
          ) : entries.length === 0 ? (
            <State icon={CheckCircle2} title="Nothing here">
              This group is empty.
            </State>
          ) : (
            entries.map((entry) => (
              <FileDiff
                key={entry.selection.path}
                repo={repo}
                selection={entry.selection}
                badge={entry.badge}
                settings={settings}
                disabled={disabled}
                scroller={scroller}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
function FileDiff({
  repo,
  selection,
  badge,
  settings,
  disabled,
  scroller,
}: {
  repo: string;
  selection: Selection;
  badge?: string;
  settings: Settings;
  disabled: boolean;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(true);
  const query = useBackend('diff', { repo, ...selection, context });
  const data = query.data;
  const tokens = useTokens(data, selection.path);
  const mode = useDiffView((s) => s.mode) ?? settings.diffMode;
  const split = mode === 'split' && data?.content === null;
  const rows = useMemo(
    () => (data ? diffRows(data, split) : []),
    [data, split],
  );
  const lines = data?.hunks.flatMap((hunk) => hunk.lines) ?? [];
  const added = lines.filter((line) => line.kind === 'add').length;
  const removed = lines.filter((line) => line.kind === 'remove').length;
  const cut = selection.path.lastIndexOf('/') + 1;
  const message = note(data, query.error);
  return (
    <div className="border-b border-line dark:border-line-dark">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`sticky top-0 z-10 flex h-tab w-full items-center gap-2 bg-sub px-3 text-sm dark:bg-sub-dark ${focus}`}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted" />
        )}
        <span className="truncate" title={selection.path}>
          <span className="text-muted">{selection.path.slice(0, cut)}</span>
          <span className="font-semibold">{selection.path.slice(cut)}</span>
        </span>
        <DiffSourcePill selection={selection} />
        {Boolean(added) && (
          <span className="shrink-0 font-mono text-label text-added dark:text-added-dark">
            +{added}
          </span>
        )}
        {Boolean(removed) && (
          <span className="shrink-0 font-mono text-label text-deleted dark:text-deleted-dark">
            −{removed}
          </span>
        )}
        {badge && <StatusBadge status={badge} />}
      </button>
      {open &&
        (message ? (
          <p className="px-3 py-2 text-xs text-muted">{message}</p>
        ) : data!.image ? (
          <div className="flex flex-col">
            <ImageDiff
              repo={repo}
              view={`${repo}:${selection.path}`}
              selection={selection}
              diff={data!}
            />
          </div>
        ) : (
          <DiffSurface
            rows={rows}
            hunks={data!.hunks}
            patches={data!.patches}
            split={split}
            wrap={false}
            whitespace={false}
            tokens={tokens}
            source={selection.source}
            disabled={disabled}
            scroller={scroller}
            hunkAction={(hunk, action) =>
              void runHunkAction(repo, selection, data!, context, hunk, action)
            }
          />
        ))}
    </div>
  );
}
