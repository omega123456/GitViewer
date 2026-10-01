import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pencil,
} from 'lucide-react';
import { perform, useBackend } from '../../lib/query';
import type {
  Diff,
  DiffStack,
  Selection,
  Settings,
  Status,
} from '../../lib/types';
import {
  CompareError,
  SameRefState,
  useComparison,
} from '../sidebar/CompareSection';
import { groupEntries, treeOrder } from '../sidebar/nodes';
import { useDiffView } from '../../stores/diff-view';
import { useDeferredFilter } from '../../stores/filter';
import { useSelection, type Stack } from '../../stores/selection';
import { Button } from '../shared/Button';
import { CopyButton } from '../shared/CopyButton';
import { Spinner } from '../shared/Spinner';
import { dynamic, focus, focusInset } from '../shared/styles';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { StatusBadge } from '../sidebar/StatusBadge';
import { ImageDiff } from '../image/ImageDiff';
import { DiffSourcePill } from './DiffSourcePill';
import { DiffSurface } from './DiffSurface';
import { FullFileButton } from './DiffToolbar';
import { canEdit } from './editable';
import { useExpansion, type Openings } from './expansion';
import { runHunkAction } from './hunks';
import { diffRows } from './rows';
import { viewStack } from './stack';
import { useTokens } from './tokens';
import { scrollPage } from './scroll';
const context = 3;
const settle = 150;
const shut: Openings = {};
interface Batch {
  data?: DiffStack;
  error: Error | null;
  settled: boolean;
  version: number;
}
function note(data: Diff | undefined, error: Error | null) {
  if (error) return error.message;
  if (!data) return 'Loading…';
  if (data.tooLarge) return 'File too large to diff. Select it to view anyway.';
  if (data.binary) return 'Binary file.';
  if (!data.image && data.content === null && data.hunks.length === 0)
    return 'No content change.';
  return null;
}
function estimate(data: Diff | undefined, open: boolean) {
  const header = 35;
  if (!open) return header;
  if (!data || data.image || note(data, null)) return header + 128;
  const lines =
    data.content !== null
      ? data.content.split('\n').length
      : data.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  return header + lines * 20 + data.hunks.length * 24;
}
const titles = {
  staged: 'Staged changes',
  unstaged: 'Changes',
  commit: 'Commit',
  compare: 'Branch comparison',
};
const labels = {
  staged: 'All staged changes',
  unstaged: 'All changes',
  commit: 'All changes in commit',
  compare: 'All changes between branches',
};
export const AllChangesPane = memo(function AllChangesPane({
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
  const filter = useDeferredFilter(repo);
  const stashed = commit?.source === 'stash';
  const files = useBackend(
    'commit_files',
    { repo, revision: commit?.revision ?? '', source: commit?.source },
    stack === 'commit',
  );
  const comparison = useComparison(repo, status, stack === 'compare');
  const compared = comparison.data;
  const entries = useMemo(
    () =>
      stack === 'commit'
        ? Object.entries(files.data?.statuses ?? {}).map(([path, badge]) => ({
            selection: { ...commit!, path },
            badge,
          }))
        : stack === 'compare'
          ? (compared?.files ?? []).map((file) => ({
              selection: {
                path: file.path,
                source: 'compare' as const,
                base: compared!.base,
                revision: compared!.target,
              },
              badge: file.status,
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
            })),
    [stack, files.data, commit, compared, status, filter],
  );
  const ordered = useMemo(() => {
    const byPath = new Map(
      entries.map((entry) => [entry.selection.path, entry]),
    );
    return treeOrder([...byPath.keys()]).map((path) => byPath.get(path)!);
  }, [entries]);
  const listing =
    stack === 'commit'
      ? files.isPending
      : stack === 'compare' && !compared && comparison.files.isPending;
  const error = stack === 'compare' ? comparison.error : files.error;
  const totals = (compared?.files ?? []).reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  const stackArgs = viewStack(repo, stack, commit, compared);
  const stacked = useBackend(
    'diff_stack',
    stackArgs ?? { repo, source: 'unstaged' },
    Boolean(stackArgs),
  );
  const settled = stacked.isSuccess && !stacked.isFetching;
  const batch = useMemo<Batch>(
    () => ({
      data: stacked.data,
      error: stacked.error,
      settled,
      version: stacked.dataUpdatedAt,
    }),
    [stacked.data, stacked.error, settled, stacked.dataUpdatedAt],
  );
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [openings, setOpenings] = useState<Record<string, Openings>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const eager = useRef(true);
  const itemKey = useCallback(
    (index: number) => ordered[index].selection.path,
    [ordered],
  );
  const virtual = useVirtualizer({
    count: ordered.length,
    getItemKey: itemKey,
    getScrollElement: () => scroller.current,
    initialOffset: () => scroller.current?.scrollTop ?? 0,
    estimateSize: (index) =>
      estimate(
        batch.data?.files[ordered[index].selection.path],
        !closed[ordered[index].selection.path],
      ),
    overscan: 2,
  });
  const laidOut = (virtual.scrollRect?.height ?? 0) > 0;
  useEffect(() => {
    if (laidOut && ordered.length) eager.current = false;
  });
  return (
    <section
      className="flex h-full min-w-0 flex-col"
      aria-label={stashed ? 'All changes in stash' : labels[stack]}
    >
      <header className="flex h-tab shrink-0 items-center gap-2 border-b border-line px-3 text-sm dark:border-line-dark">
        <span className="font-semibold">
          {stashed ? 'Stash' : titles[stack]}
        </span>
        {commit?.revision && (
          <span className="font-mono text-label text-muted">
            {commit.revision.slice(0, 7)}
          </span>
        )}
        {stack === 'compare' && (
          <span className="truncate font-mono text-label">
            {comparison.base}{' '}
            <span className="text-faint dark:text-faint-dark">→</span>{' '}
            {comparison.target}
          </span>
        )}
        {stack === 'compare' && !listing ? (
          <span className="ml-auto shrink-0 font-mono text-label text-muted">
            {entries.length} files ·{' '}
            <span className="text-added dark:text-added-dark">
              +{totals.additions}
            </span>{' '}
            <span className="text-deleted dark:text-deleted-dark">
              −{totals.deletions}
            </span>
          </span>
        ) : listing ? (
          <Spinner className="size-3.5 text-muted" />
        ) : (
          <span className="font-mono text-label text-muted">
            {entries.length}
          </span>
        )}
      </header>
      <div
        ref={scroller}
        tabIndex={-1}
        role="region"
        aria-label="Stacked diff content"
        onKeyDownCapture={scrollPage}
        className={`relative min-h-0 flex-1 overflow-y-auto ${focusInset}`}
      >
        <div>
          {stack === 'compare' && comparison.same ? (
            <SameRefState />
          ) : error && stack === 'compare' ? (
            <CompareError
              repo={repo}
              message={error.message}
              mergeBase={comparison.mergeBase}
            />
          ) : error ? (
            <ErrorState
              title="Could not list the changes"
              error={error}
              retry={() => void files.refetch()}
            />
          ) : listing ? (
            <State icon={Loader2} title="Loading changes">
              Reading the changed files.
            </State>
          ) : entries.length === 0 ? (
            <State icon={CheckCircle2} title="Nothing here">
              This group is empty.
            </State>
          ) : (
            <div
              className="relative h-virtual"
              style={dynamic({
                '--virtual-height': `${virtual.getTotalSize()}px`,
              })}
            >
              {virtual.getVirtualItems().map((item) => {
                const entry = ordered[item.index];
                const path = entry.selection.path;
                return (
                  <div
                    key={item.key}
                    ref={virtual.measureElement}
                    data-index={item.index}
                    className="absolute top-row left-0 w-full"
                    style={dynamic({ '--row-offset': `${item.start}px` })}
                  >
                    <FileDiff
                      repo={repo}
                      selection={entry.selection}
                      badge={entry.badge}
                      batch={batch}
                      settings={settings}
                      disabled={disabled}
                      scroller={scroller}
                      start={item.start}
                      closed={Boolean(closed[path])}
                      setClosed={setClosed}
                      opening={openings[path]}
                      setOpenings={setOpenings}
                      eager={eager}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});
function useGate(
  box: RefObject<HTMLDivElement | null>,
  scroller: RefObject<HTMLDivElement | null>,
  eager: RefObject<boolean>,
  report: (visible: boolean) => void,
) {
  const latest = useRef(report);
  useEffect(() => {
    latest.current = report;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let immediate = eager.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[entries.length - 1].isIntersecting;
        clearTimeout(timer);
        if (immediate) latest.current(visible);
        else timer = setTimeout(() => latest.current(visible), settle);
        immediate = false;
      },
      { root: scroller.current, rootMargin: '400px' },
    );
    observer.observe(box.current!);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [box, scroller, eager]);
}
const FileDiff = memo(function FileDiff({
  repo,
  selection,
  badge,
  batch,
  settings,
  disabled,
  scroller,
  start,
  closed,
  setClosed,
  opening,
  setOpenings,
  eager,
}: {
  repo: string;
  selection: Selection;
  badge?: string;
  batch: Batch;
  settings: Settings;
  disabled: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  start: number;
  closed: boolean;
  setClosed: Dispatch<SetStateAction<Record<string, boolean>>>;
  opening?: Openings;
  setOpenings: Dispatch<SetStateAction<Record<string, Openings>>>;
  eager: RefObject<boolean>;
}) {
  const path = selection.path;
  const open = !closed;
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [inner, setInner] = useState(0);
  useGate(box, scroller, eager, (visible) => {
    setNear(visible);
    if (visible) setMounted(true);
  });
  const entry = batch.data?.files[path];
  const missing = batch.settled && !entry;
  const fallback = useBackend(
    'diff',
    { repo, ...selection, context },
    missing && near,
  );
  const data = entry ?? (missing ? fallback.data : undefined);
  const error = entry
    ? null
    : (batch.error ?? (missing ? fallback.error : null));
  const version = entry ? batch.version : fallback.dataUpdatedAt;
  const setOpening = useCallback(
    (action: SetStateAction<Openings>) =>
      setOpenings((all) => ({
        ...all,
        [path]:
          typeof action === 'function' ? action(all[path] ?? shut) : action,
      })),
    [path, setOpenings],
  );
  const expansion = useExpansion(repo, selection, data, [
    opening ?? shut,
    setOpening,
  ]);
  const tokens = useTokens(data, path, near, expansion.reveal.lines);
  const mode = useDiffView((s) => s.mode) ?? settings.diffMode;
  const split = mode === 'split' && data?.content === null;
  const rows = useMemo(
    () => (data ? diffRows(data, split, expansion.reveal) : []),
    [data, split, expansion.reveal],
  );
  const { added, removed } = useMemo(() => {
    const lines = data?.hunks.flatMap((hunk) => hunk.lines) ?? [];
    return {
      added: lines.filter((line) => line.kind === 'add').length,
      removed: lines.filter((line) => line.kind === 'remove').length,
    };
  }, [data]);
  const hunkAction = useCallback(
    (hunk: number, action: string) =>
      void runHunkAction(repo, selection, data!, hunk, action),
    [repo, selection, data],
  );
  const message = note(data, error);
  const surface = open && !message && mounted;
  useLayoutEffect(() => {
    setInner(body.current?.offsetTop ?? 0);
  }, [surface]);
  const cut = selection.path.lastIndexOf('/') + 1;
  const reserved = data?.image
    ? null
    : rows.reduce(
        (sum, row) => sum + (row.hunk === undefined && !row.gap ? 20 : 24),
        0,
      );
  return (
    <div ref={box} className="border-b border-line dark:border-line-dark">
      <div className="sticky top-0 z-10 flex h-tab items-center gap-1 bg-sub pr-3 dark:bg-sub-dark">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setClosed((all) => ({ ...all, [path]: !all[path] }))}
          className={`flex h-full min-w-0 flex-1 items-center gap-2 pl-3 text-sm ${focus}`}
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
        {open && expansion.available && (
          <FullFileButton full={expansion.full} toggle={expansion.toggleFull} />
        )}
        <CopyButton
          text={selection.path}
          label="Copy file path"
          className="size-6 text-muted dark:text-muted-dark"
        />
        <Button
          title="Open in system application"
          onClick={() =>
            void perform('system_open', { repo, path: selection.path })
          }
        >
          <ExternalLink className="size-4" />
          <span>Open</span>
        </Button>
        {canEdit(selection.source, badge, data) && (
          <Button
            title="Edit this file"
            onClick={() =>
              useSelection
                .getState()
                .select(repo, { ...selection, editing: true })
            }
          >
            <Pencil className="size-4" />
            <span>Edit</span>
          </Button>
        )}
      </div>
      {open &&
        (message ? (
          <p
            className={`px-3 py-2 text-xs text-muted ${data ? '' : 'min-h-32'}`}
          >
            {message}
          </p>
        ) : !mounted ? (
          <p
            className={`px-3 py-2 text-xs text-muted ${reserved === null ? 'min-h-32' : 'h-virtual'}`}
            style={
              reserved === null
                ? undefined
                : dynamic({ '--virtual-height': `${reserved}px` })
            }
          >
            Loading…
          </p>
        ) : (
          <div ref={body}>
            {data!.image ? (
              <div className="flex flex-col">
                <ImageDiff
                  repo={repo}
                  view={`${repo}:${selection.path}`}
                  selection={selection}
                  diff={data!}
                  version={version}
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
                scrollMargin={start + inner}
                hunkAction={hunkAction}
                expansion={expansion}
              />
            )}
          </div>
        ))}
    </div>
  );
});
