import type { Ref } from 'react';
import { format, formatDistanceToNow, fromUnixTime } from 'date-fns';
import { useBackend } from '../../lib/query';
import { useLayout } from '../../stores/layout';
import { useSelection } from '../../stores/selection';
import type { Selection } from '../../lib/types';
import { Avatar } from '../shared/Avatar';
import { Button } from '../shared/Button';
import { VirtualList, type VirtualListHandle } from '../shared/VirtualList';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { findClass, findTokens, type Found } from './find';
export function BlameView({
  repo,
  selection,
  list,
  found,
}: {
  repo: string;
  selection: Selection;
  list?: Ref<VirtualListHandle>;
  found?: Found;
}) {
  const query = useBackend('blame', { repo, path: selection.path });
  return query.error ? (
    <ErrorState
      title="Could not load blame"
      error={query.error}
      retry={() => void query.refetch()}
    />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col font-mono text-diff">
      <VirtualList
        ref={list}
        label="Blame lines"
        height={26}
        items={query.data ?? []}
        render={(line, index) => (
          <div
            key={line.line}
            className={`flex ${line.block ? 'border-t border-line dark:border-line-dark' : ''}`}
          >
            <Button
              className="w-16 justify-start text-label text-muted"
              title={line.hash}
              onClick={() => {
                useLayout.getState().update(repo, { mode: 'history' });
                useSelection.getState().select(repo, {
                  path: selection.path,
                  source: 'commit',
                  revision: line.hash,
                });
              }}
            >
              {line.block ? line.hash.slice(0, 7) : ''}
            </Button>
            <span
              className="flex w-6 shrink-0 justify-center"
              title={line.block ? line.author : undefined}
            >
              {line.block && <Avatar small author={line.author} />}
            </span>
            <span
              className="w-20 shrink-0 truncate text-label text-faint dark:text-faint-dark"
              title={
                line.block
                  ? format(fromUnixTime(line.timestamp), 'PPpp')
                  : undefined
              }
            >
              {line.block
                ? formatDistanceToNow(fromUnixTime(line.timestamp), {
                    addSuffix: true,
                  })
                : ''}
            </span>
            <span className="w-11 shrink-0 bg-gutter px-2 text-right text-label text-faint dark:bg-gutter-dark dark:text-faint-dark">
              {line.line}
            </span>
            <code className="file-content px-2 whitespace-pre">
              {findTokens([{ content: line.content }], found, index).map(
                (token, position) => (
                  <span key={position} className={findClass(token)}>
                    {token.content}
                  </span>
                ),
              )}
            </code>
          </div>
        )}
      />
      {query.data?.length === 0 && (
        <State title="No blame available">This file is not in HEAD.</State>
      )}
    </div>
  );
}
