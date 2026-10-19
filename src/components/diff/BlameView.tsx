import type { Ref } from 'react';
import { format, formatDistanceToNowStrict, fromUnixTime } from 'date-fns';
import { useBackend } from '../../lib/query';
import { useLayout, useLayoutFields } from '../../stores/layout';
import { useSelection } from '../../stores/selection';
import type { Selection } from '../../lib/types';
import { dynamic, focus } from '../shared/styles';
import { VirtualList, type VirtualListHandle } from '../shared/VirtualList';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { ResizeHandle } from '../shell/ResizeHandle';
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
  const { blameWidth } = useLayoutFields(repo, 'blameWidth');
  return query.error ? (
    <ErrorState
      title="Could not load blame"
      error={query.error}
      retry={() => void query.refetch()}
    />
  ) : (
    <div
      className="relative flex min-h-0 flex-1 flex-col font-mono text-diff"
      style={dynamic({ '--blame-width': `${blameWidth}px` })}
    >
      <VirtualList
        ref={list}
        label="Blame lines"
        height={26}
        items={query.data ?? []}
        render={(line, index) => (
          <div
            key={line.line}
            className={`flex w-max min-w-full ${line.block ? 'border-t border-line dark:border-line-dark' : ''}`}
          >
            <div className="sticky left-0 z-10 flex w-blame shrink-0 items-center gap-2 overflow-hidden bg-surface pl-2 font-sans text-label text-muted dark:bg-surface-dark dark:text-muted-dark">
              {line.block && (
                <>
                  <button
                    type="button"
                    className={`w-14 shrink-0 rounded text-left font-mono text-label text-accent hover:underline dark:text-accent-dark ${focus}`}
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
                    {line.hash.slice(0, 7)}
                  </button>
                  <span className="w-26 shrink-0 truncate text-ink dark:text-ink-dark">
                    {line.author}
                  </span>
                  <span
                    className="w-21 shrink-0 truncate tabular-nums"
                    title={format(fromUnixTime(line.timestamp), 'PPpp')}
                  >
                    {formatDistanceToNowStrict(fromUnixTime(line.timestamp), {
                      addSuffix: true,
                    })}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={line.subject}
                  >
                    {line.subject}
                  </span>
                </>
              )}
            </div>
            <span className="w-1 shrink-0" />
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
      {Boolean(query.data?.length) && (
        <ResizeHandle
          label="Resize blame annotations"
          orientation="horizontal"
          min={360}
          max={640}
          step={10}
          value={blameWidth}
          className="absolute inset-y-0 left-blame z-20 w-1 cursor-col-resize bg-line hover:bg-accent focus-visible:bg-accent dark:bg-line-dark"
          measure={(event) => {
            const pane =
              event.currentTarget.parentElement!.getBoundingClientRect();
            return Math.min(event.clientX - pane.left, pane.width - 320);
          }}
          onChange={(width) =>
            useLayout.getState().update(repo, { blameWidth: width })
          }
        />
      )}
      {query.data?.length === 0 && (
        <State title="No blame available">This file is not in HEAD.</State>
      )}
    </div>
  );
}
