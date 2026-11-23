import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { useActions } from '../../lib/actions';
import { scopeKey } from '../../lib/git';
import { useBackend } from '../../lib/query';
import type { Comparison, Selection, Settings, Status } from '../../lib/types';
import { useDeferredFilter } from '../../stores/filter';
import type { Stack } from '../../stores/selection';
import { useComparison } from '../sidebar/CompareSection';
import type { Openings } from './expansion';
import { findActions } from './FindBar';
import { foundByPath, useFind, type Located } from './find';
import { viewStack } from './stack';
import {
  comparisonTotals,
  orderEntries,
  searchableLines,
  stackEntries,
  type StackEntry,
} from './stack-entries';
import {
  estimateFileHeight,
  type Batch,
  type PaneContext,
} from './StackFileDiff';
const FILE_OVERSCAN = 2;
function useStackBatch(
  repo: string,
  stack: Stack,
  target: { commit: Selection | undefined; compared: Comparison | undefined },
): Batch {
  const stackArgs = viewStack({
    repo: repo,
    stack: stack,
    commit: target.commit,
    compared: target.compared,
  });
  const stacked = useBackend(
    'diff_stack',
    stackArgs ?? { repo: repo, source: 'unstaged' },
    Boolean(stackArgs),
  );
  const settled = stacked.isSuccess && !stacked.isFetching;
  return useMemo<Batch>(
    () => ({
      data: stacked.data,
      error: stacked.error,
      settled: settled,
      version: stacked.dataUpdatedAt,
    }),
    [stacked.data, stacked.error, settled, stacked.dataUpdatedAt],
  );
}
export function useStackSources({
  repo,
  stack,
  commit,
  status,
}: {
  repo: string;
  stack: Stack;
  commit: Selection | undefined;
  status: Status;
}) {
  const filter = useDeferredFilter(repo);
  const files = useBackend(
    'commit_files',
    { repo: repo, revision: commit?.revision ?? '', source: commit?.source },
    stack === 'commit',
  );
  const comparison = useComparison(repo, status, stack === 'compare');
  const compared = comparison.data;
  const entries = useMemo(
    () =>
      stackEntries({
        stack: stack,
        commit: commit,
        commitStatuses: files.data?.statuses ?? {},
        compared: compared,
        status: status,
        filter: filter,
      }),
    [stack, files.data, commit, compared, status, filter],
  );
  const ordered = useMemo(() => orderEntries(entries), [entries]);
  const batch = useStackBatch(repo, stack, { commit, compared });
  const comparePending =
    stack === 'compare' && !compared && comparison.files.isPending;
  const listing = stack === 'commit' ? files.isPending : comparePending;
  const error = stack === 'compare' ? comparison.error : files.error;
  return {
    files: files,
    comparison: comparison,
    compared: compared,
    entries: entries,
    ordered: ordered,
    batch: batch,
    listing: listing,
    error: error,
  };
}
export function useStackSearch({
  ordered,
  batch,
  virtual,
  setClosed,
}: {
  ordered: StackEntry[];
  batch: Batch;
  virtual: Virtualizer<HTMLDivElement, Element>;
  setClosed: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const searchable = useMemo(
    () => searchableLines(ordered, batch.data?.files),
    [ordered, batch.data],
  );
  const texts = useCallback(
    () => searchable.map((line) => line.content),
    [searchable],
  );
  const [jump, setJump] = useState<Located>();
  const clearJump = useCallback(() => setJump(undefined), []);
  const find = useFind(texts, (index) => {
    const line = searchable[index];
    const position = ordered.findIndex(
      (entry) => entry.selection.path === line.path,
    );
    setClosed((all) => (all[line.path] ? { ...all, [line.path]: false } : all));
    setJump({ ...line });
    const range = virtual.range;
    const outsideRange =
      !range || position < range.startIndex || position > range.endIndex;
    if (outsideRange)
      virtual.scrollToOffset(
        virtual.getOffsetForIndex(position, 'start')?.[0] ?? 0,
      );
  });
  const located = useMemo(
    () => foundByPath(find.found, searchable),
    [find.found, searchable],
  );
  return { find, located, jump, clearJump };
}
function useStackVirtualizer({
  ordered,
  batch,
  closed,
  scroller,
}: {
  ordered: StackEntry[];
  batch: Batch;
  closed: Record<string, boolean>;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const itemKey = useCallback(
    (index: number) => ordered[index].selection.path,
    [ordered],
  );
  return useVirtualizer({
    count: ordered.length,
    getItemKey: itemKey,
    getScrollElement: () => scroller.current,
    initialOffset: () => scroller.current?.scrollTop ?? 0,
    estimateSize: (index) => {
      const path = ordered[index].selection.path;
      return estimateFileHeight(batch.data?.files[path], !closed[path]);
    },
    overscan: FILE_OVERSCAN,
  });
}
interface AllChangesControllerParams {
  repo: string;
  stack: Stack;
  commit: Selection | undefined;
  status: Status;
  settings: Settings;
  disabled: boolean;
}
function buildControllerState({
  sources,
  scroller,
  virtual,
  search,
  pane,
  closed,
  openings,
}: {
  sources: ReturnType<typeof useStackSources>;
  scroller: RefObject<HTMLDivElement | null>;
  virtual: Virtualizer<HTMLDivElement, Element>;
  search: ReturnType<typeof useStackSearch>;
  pane: PaneContext;
  closed: Record<string, boolean>;
  openings: Record<string, Openings>;
}) {
  return {
    scroller: scroller,
    find: search.find,
    listing: sources.listing,
    count: sources.entries.length,
    compare: {
      base: sources.comparison.base,
      target: sources.comparison.target,
      totals: comparisonTotals(sources.compared),
    },
    bodyState: {
      sameComparison: sources.comparison.same,
      error: sources.error,
      mergeBase: sources.comparison.mergeBase,
      listing: sources.listing,
      empty: sources.entries.length === 0,
      onRetryFiles: () => void sources.files.refetch(),
    },
    bodyList: {
      virtual: virtual,
      ordered: sources.ordered,
      pane: pane,
      closed: closed,
      openings: openings,
      located: search.located,
      jump: search.jump,
    },
  };
}
export function useAllChangesController({
  repo,
  stack,
  commit,
  status,
  settings,
  disabled,
}: AllChangesControllerParams) {
  const sources = useStackSources({ repo, stack, commit, status });
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [openings, setOpenings] = useState<Record<string, Openings>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const eager = useRef(true);
  const virtual = useStackVirtualizer({
    ordered: sources.ordered,
    batch: sources.batch,
    closed: closed,
    scroller: scroller,
  });
  const search = useStackSearch({
    ordered: sources.ordered,
    batch: sources.batch,
    virtual: virtual,
    setClosed: setClosed,
  });
  const pane = useMemo<PaneContext>(
    () => ({
      repo: repo,
      batch: sources.batch,
      settings: settings,
      disabled: disabled,
      scroller: scroller,
      eager: eager,
      setClosed: setClosed,
      setOpenings: setOpenings,
      onJumped: search.clearJump,
    }),
    [repo, sources.batch, settings, disabled, search.clearJump],
  );
  useActions(scopeKey(repo, 'diff'), findActions(search.find, false));
  const laidOut = (virtual.scrollRect?.height ?? 0) > 0;
  useEffect(() => {
    if (laidOut && sources.ordered.length) eager.current = false;
  });
  return buildControllerState({
    sources,
    scroller,
    virtual,
    search,
    pane,
    closed,
    openings,
  });
}
