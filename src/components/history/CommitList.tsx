import { RevisionTree } from '../sidebar/RevisionTree';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict, fromUnixTime } from 'date-fns';
import { FileDiff, History } from 'lucide-react';
import { invoke } from '../../lib/ipc';
import { useBackend } from '../../lib/query';
import { useTabLayout } from '../../stores/layout';
import {
  useCurrentSelection,
  useHistoryPath,
  useSelection,
} from '../../stores/selection';
import { Avatar } from '../shared/Avatar';
import { Button } from '../shared/Button';
import { GroupHeader } from '../shared/Section';
import { VirtualList } from '../shared/VirtualList';
import { State } from '../states/State';
import { LaneGraph } from './LaneGraph';
const refColours = [
  'text-lane-1 dark:text-lane-1-dark',
  'text-lane-2 dark:text-lane-2-dark',
  'text-lane-3 dark:text-lane-3-dark',
  'text-lane-4 dark:text-lane-4-dark',
  'text-lane-5 dark:text-lane-5-dark',
  'text-lane-6 dark:text-lane-6-dark',
  'text-lane-7 dark:text-lane-7-dark',
  'text-lane-8 dark:text-lane-8-dark',
];
export function CommitList({ repo }: { repo: string }) {
  const { history } = useTabLayout(repo);
  const path = useHistoryPath(repo);
  const status = useBackend('status', { repo });
  const query = useInfiniteQuery({
    queryKey: [repo, 'history', path],
    initialPageParam: '',
    enabled: history,
    queryFn: ({ pageParam }) =>
      invoke('history', { repo, path, cursor: pageParam }),
    getNextPageParam: (page) => page.cursor ?? undefined,
  });
  const selection = useCurrentSelection(repo, true);
  const files = useBackend(
    'commit_files',
    {
      repo,
      revision: selection?.revision ?? '',
      source: selection?.source ?? 'commit',
    },
    Boolean(selection?.revision),
  );
  const commits = query.data?.pages.flatMap((page) => page.commits) ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="flex h-section shrink-0 items-center gap-1.5 border-b border-line bg-sub px-2 text-label font-semibold tracking-wider text-muted uppercase dark:border-line-dark dark:bg-sub-dark">
        <History className="size-3 shrink-0" />
        <span className="truncate">{status.data?.branch}</span>
        <span className="ml-auto shrink-0 rounded-full bg-hover px-1.5 font-mono font-normal tracking-normal dark:bg-hover-dark">
          {commits.length}
        </span>
      </h2>
      {path && (
        <div className="flex shrink-0 items-center p-2 text-xs">
          <span className="truncate">History: {path}</span>
          <Button
            className="ml-auto"
            onClick={() => useSelection.getState().setPath(repo, '')}
          >
            All files
          </Button>
        </div>
      )}
      {query.error ? (
        <State title="Unable to load history">{query.error.message}</State>
      ) : (
        <VirtualList
          label="Commit history"
          onEnd={() => {
            if (query.hasNextPage && !query.isFetchingNextPage)
              void query.fetchNextPage();
          }}
          items={commits}
          height={30}
          render={(commit) => (
            <button
              className={`relative flex h-commit w-full items-center gap-2 pr-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-hover-dark ${selection?.revision === commit.hash ? 'bg-selected dark:bg-selected-dark' : ''}`}
              onClick={() =>
                useSelection.getState().select(repo, {
                  path,
                  source: 'commit',
                  revision: commit.hash,
                })
              }
            >
              {selection?.revision === commit.hash && (
                <span className="absolute inset-y-0 left-0 w-accent bg-accent" />
              )}
              <LaneGraph
                commit={commit}
                head={commit.hash === status.data?.oid}
              />
              <Avatar author={commit.author} />
              <span
                className="min-w-0 flex-1 truncate text-xs"
                title={`${commit.subject}\n${commit.author}`}
              >
                {commit.subject}
              </span>
              {commit.refs && (
                <span
                  className={`max-w-24 shrink-0 truncate rounded-full border border-current px-1.5 text-label ${refColours[commit.lane % 8]}`}
                >
                  {commit.refs}
                </span>
              )}
              <span className="shrink-0 font-mono text-label text-muted">
                {commit.hash.slice(0, 7)}
              </span>
              <span className="shrink-0 text-label text-muted tabular-nums">
                {formatDistanceToNowStrict(fromUnixTime(commit.timestamp))}
              </span>
            </button>
          )}
        />
      )}
      {query.hasNextPage && (
        <Button
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Load more commits
        </Button>
      )}
      {commits.length === 0 && !query.isPending && !query.error && (
        <State title="No commits yet" />
      )}
      {selection?.revision && (
        <div className="flex h-1/3 min-h-24 flex-col border-t border-line dark:border-line-dark">
          <GroupHeader
            title="Files in commit"
            count={files.data?.length ?? 0}
            actions={
              <Button
                className="size-6 p-0"
                aria-label="View all changes in commit"
                title="View all changes in commit"
                onClick={() => useSelection.getState().viewAll(repo, 'commit')}
              >
                <FileDiff className="size-3.5" />
              </Button>
            }
          />
          {files.error && <p role="alert">{files.error.message}</p>}
          {files.data && (
            <RevisionTree
              key={selection.revision}
              label="Commit files"
              paths={files.data}
              selectedPath={selection.path}
              onSelect={(path) =>
                useSelection.getState().select(repo, {
                  path,
                  source: selection.source,
                  revision: selection.revision,
                })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
