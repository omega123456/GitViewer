import { RevisionTree } from '../sidebar/RevisionTree';
import { revisionTree } from '../sidebar/reveal';
import { sumLines } from '../shared/LineCount';
import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { relativeTime } from '../../lib/time';
import { History } from 'lucide-react';
import { invoke } from '../../lib/ipc';
import { useBackend } from '../../lib/query';
import type { Commit, Selection } from '../../lib/types';
import { useSidebarMode, type SidebarMode } from '../../stores/layout';
import {
  useCurrentSelection,
  useHistoryPath,
  useSelection,
} from '../../stores/selection';
import { Avatar } from '../shared/Avatar';
import { Button } from '../shared/Button';
import { ViewAllButton } from '../shared/ViewAllButton';
import { GroupHeader } from '../shared/Section';
import { VirtualList, type VirtualListHandle } from '../shared/VirtualList';
import { ErrorRetry, ErrorState } from '../states/Errors';
import { State } from '../states/State';
import {
  clickable,
  dynamic,
  focus,
  pill,
  mutedLabel,
  selectedRow,
} from '../shared/styles';
import { CommitDetails } from './CommitDetails';
import { LaneGraph, graphWidth, laneCount } from './LaneGraph';
import { laneColours } from '../shared/lanes';
import { shortHash } from '../../lib/git';
import { useOpenFile } from '../../lib/open-file';
const COMMIT_ROW_HEIGHT = 44;
interface ScrollToRevisionOptions {
  list: RefObject<VirtualListHandle | null>;
  revision: string | undefined;
  mode: SidebarMode;
  loaded: boolean;
  commits: Commit[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
}
function useScrollToRevision({
  list,
  revision,
  mode,
  loaded,
  commits,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: ScrollToRevisionOptions) {
  const sought = useRef<string>(undefined);
  useEffect(() => {
    sought.current = revision;
  }, [revision]);
  useEffect(() => {
    const waiting = !sought.current || mode !== 'history' || !loaded;
    if (waiting) return;
    const index = commits.findIndex((commit) => commit.hash === sought.current);
    if (index >= 0) {
      sought.current = undefined;
      list.current?.scrollToIndex(index, 'auto');
      return;
    }
    if (!hasNextPage) {
      sought.current = undefined;
      return;
    }
    if (!isFetchingNextPage) void fetchNextPage();
  }, [
    list,
    revision,
    mode,
    loaded,
    commits,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);
}
function CommitRow({
  commit,
  lanes,
  selected,
  isHead,
  onSelect,
}: {
  commit: Commit;
  lanes: number;
  selected: boolean;
  isHead: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="px-1">
      <button
        className={`relative flex h-commit w-full items-center gap-2 rounded pr-2 text-left hover:bg-hover dark:hover:bg-hover-dark ${selected ? selectedRow : ''} ${clickable} ${focus}`}
        onClick={onSelect}
      >
        {selected && <span className={pill} />}
        <LaneGraph commit={commit} lanes={lanes} head={isHead} />
        <Avatar author={commit.author} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="min-w-0 flex-1 truncate text-sm"
              title={commit.subject}
            >
              {commit.subject}
            </span>
            {commit.refs && (
              <span
                className={`max-w-24 shrink-0 truncate rounded-full border border-current px-1.5 text-label ${laneColours[commit.color].text}`}
              >
                {commit.refs}
              </span>
            )}
          </span>
          <span className={`flex min-w-0 items-center gap-2 ${mutedLabel}`}>
            <span className="min-w-0 truncate text-ink dark:text-ink-dark">
              {commit.author}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 tabular-nums">
              {relativeTime(commit.timestamp)}
            </span>
            <span className="ml-auto shrink-0 font-mono text-badge">
              {shortHash(commit.hash)}
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}
function CommitFilesPanel({
  repo,
  selection,
  onSelect,
}: {
  repo: string;
  selection: Selection;
  onSelect: (path: string) => void;
}) {
  const revision = selection.revision ?? '';
  const files = useBackend(
    'commit_files',
    { repo: repo, revision: revision, source: selection.source },
    Boolean(revision),
  );
  const paths = useMemo(
    () => Object.keys(files.data?.statuses ?? {}),
    [files.data],
  );
  const total = useMemo(
    () => sumLines(files.data?.lines, paths),
    [files.data, paths],
  );
  return (
    <div className="flex h-1/3 min-h-24 flex-col border-t border-line dark:border-line-dark">
      <GroupHeader
        title="Files in commit"
        count={paths.length}
        lines={total}
        actions={
          <ViewAllButton
            repo={repo}
            stack="commit"
            label="All changes in commit"
            look="section"
          />
        }
      />
      <ErrorRetry label="Could not load the commit files" query={files} />
      {files.data && (
        <RevisionTree
          key={revision}
          repo={repo}
          tree={revisionTree(selection)}
          label="Commit files"
          paths={paths}
          statuses={files.data.statuses}
          lines={files.data.lines}
          selectedPath={selection.path}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}
function PathFilterBanner({ repo, path }: { repo: string; path: string }) {
  return (
    <div className="flex shrink-0 items-center p-2 text-sm">
      <span className="truncate">History: {path}</span>
      <Button
        className="ml-auto"
        onClick={() => useSelection.getState().setPath(repo, '')}
      >
        All files
      </Button>
    </div>
  );
}
function HistoryHeader({
  branch,
  count,
}: {
  branch: string | undefined;
  count: number;
}) {
  return (
    <h2 className="flex h-section shrink-0 items-center gap-1.5 border-b border-line bg-sub pr-2 pl-2.5 text-label font-semibold text-muted dark:border-line-dark dark:bg-sub-dark dark:text-muted-dark">
      <History className="size-3 shrink-0" />
      <span className="truncate">{branch}</span>
      <span className="ml-auto shrink-0 rounded-full bg-hover px-1.5 font-mono text-badge font-normal dark:bg-hover-dark">
        {count}
      </span>
    </h2>
  );
}
function CommitListBody({
  list,
  commits,
  lanes,
  state,
}: {
  list: RefObject<VirtualListHandle | null>;
  commits: Commit[];
  lanes: number;
  state: {
    error: Error | null;
    isPending: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    selectedRevision: string | undefined;
    headOid: string | undefined;
    onRetry: () => void;
    onLoadNext: () => void;
    onSelectCommit: (hash: string) => void;
  };
}) {
  if (state.error)
    return (
      <ErrorState
        title="Could not load history"
        error={state.error}
        retry={state.onRetry}
      />
    );
  const empty = commits.length === 0 && !state.isPending;
  return (
    <>
      <VirtualList
        ref={list}
        label="Commit history"
        onEnd={state.onLoadNext}
        items={commits}
        height={COMMIT_ROW_HEIGHT}
        render={(commit) => (
          <CommitRow
            commit={commit}
            lanes={lanes}
            selected={state.selectedRevision === commit.hash}
            isHead={commit.hash === state.headOid}
            onSelect={() => state.onSelectCommit(commit.hash)}
          />
        )}
      />
      {state.hasNextPage && (
        <Button onClick={state.onLoadNext} disabled={state.isFetchingNextPage}>
          Load more commits
        </Button>
      )}
      {empty && <State title="No commits yet" />}
    </>
  );
}
function useHistoryCommits(repo: string, mode: SidebarMode, path: string) {
  const query = useInfiniteQuery({
    queryKey: [repo, 'history', path],
    initialPageParam: '',
    enabled: mode === 'history',
    queryFn: ({ pageParam }) =>
      invoke('history', { repo: repo, path: path, cursor: pageParam }),
    getNextPageParam: (page) => page.cursor ?? undefined,
  });
  const commits = useMemo(
    () => query.data?.pages.flatMap((page) => page.commits) ?? [],
    [query.data],
  );
  const loadNextPage = () => {
    if (query.hasNextPage && !query.isFetchingNextPage)
      void query.fetchNextPage();
  };
  return { query, commits, loadNextPage };
}
function SelectedCommitPanel({
  repo,
  selection,
  onSelectFile,
}: {
  repo: string;
  selection: Selection | undefined;
  onSelectFile: (filePath: string) => void;
}) {
  if (!selection?.revision) return null;
  return (
    <>
      <CommitDetails repo={repo} revision={selection.revision} />
      <CommitFilesPanel
        repo={repo}
        selection={selection}
        onSelect={onSelectFile}
      />
    </>
  );
}
export const CommitList = memo(function CommitList({ repo }: { repo: string }) {
  const mode = useSidebarMode(repo);
  const path = useHistoryPath(repo);
  const status = useBackend('status', { repo });
  const { query, commits, loadNextPage } = useHistoryCommits(repo, mode, path);
  const selection = useCurrentSelection(repo, 'history');
  const openFile = useOpenFile(repo);
  const list = useRef<VirtualListHandle>(null);
  useScrollToRevision({
    list: list,
    revision: selection?.revision,
    mode: mode,
    loaded: Boolean(query.data),
    commits: commits,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  });
  const lanes = laneCount(commits);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={dynamic({ '--graph-width': `${graphWidth(lanes)}px` })}
    >
      <HistoryHeader branch={status.data?.branch} count={commits.length} />
      {path && <PathFilterBanner repo={repo} path={path} />}
      <CommitListBody
        list={list}
        commits={commits}
        lanes={lanes}
        state={{
          error: query.error,
          isPending: query.isPending,
          hasNextPage: query.hasNextPage,
          isFetchingNextPage: query.isFetchingNextPage,
          selectedRevision: selection?.revision,
          headOid: status.data?.oid,
          onRetry: () => void query.refetch(),
          onLoadNext: loadNextPage,
          onSelectCommit: (hash) =>
            openFile({ path: path, source: 'commit', revision: hash }),
        }}
      />
      <SelectedCommitPanel
        repo={repo}
        selection={selection}
        onSelectFile={(filePath) =>
          selection &&
          openFile({
            path: filePath,
            source: selection.source,
            revision: selection.revision,
          })
        }
      />
    </div>
  );
});
