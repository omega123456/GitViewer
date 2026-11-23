import type { QueryCacheNotifyEvent } from '@tanstack/react-query';
import { client } from './query';
const TREE_COMMAND = 'tree';
export function isTreeInvalidation(event: QueryCacheNotifyEvent, repo: string) {
  if (event.type !== 'updated') return false;
  if (event.action.type !== 'invalidate') return false;
  const [scope, command] = event.query.queryKey;
  return scope === repo && command === TREE_COMMAND;
}
function hasInvalidatedTree(repo: string) {
  return client
    .getQueryCache()
    .findAll({ queryKey: [repo, TREE_COMMAND] })
    .some((query) => query.state.isInvalidated);
}
export function watchTreeInvalidation(repo: string, relist: () => void) {
  let pending = false;
  const run = () => {
    pending = false;
    relist();
  };
  const schedule = () => {
    pending = true;
    queueMicrotask(run);
  };
  const stop = client.getQueryCache().subscribe((event) => {
    if (pending || !isTreeInvalidation(event, repo)) return;
    schedule();
  });
  if (hasInvalidatedTree(repo)) schedule();
  return stop;
}
