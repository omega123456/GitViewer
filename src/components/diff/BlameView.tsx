import { formatDistanceToNow, fromUnixTime } from 'date-fns';
import { useBackend } from '../../lib/query';
import { useLayout } from '../../stores/layout';
import { useSelection } from '../../stores/selection';
import type { Selection } from '../../lib/types';
import { Avatar } from '../shared/Avatar';
import { Button } from '../shared/Button';
import { VirtualList } from '../shared/VirtualList';
import { State } from '../states/State';
export function BlameView({
  repo,
  selection,
}: {
  repo: string;
  selection: Selection;
}) {
  const query = useBackend('blame', { repo, path: selection.path });
  return query.error ? (
    <State title="Unable to read blame">{query.error.message}</State>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col font-mono text-diff">
      <VirtualList
        label="Blame lines"
        height={26}
        items={query.data ?? []}
        render={(line) => (
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
            <span className="flex w-6 shrink-0 justify-center">
              {line.block && <Avatar small author={line.author} />}
            </span>
            <span className="w-20 shrink-0 truncate text-label text-faint dark:text-faint-dark">
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
              {line.content}
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
