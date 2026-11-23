import { milliseconds, type Duration } from 'date-fns';
import { invoke } from './ipc';
import { useTabs } from '../stores/tabs';
function shownViews() {
  return useTabs.getState().tabs.map((tab) => tab.view);
}
function fetchQuietly(view: string, fetching: Set<string>) {
  if (fetching.has(view)) return;
  fetching.add(view);
  invoke('sync', { repo: view, action: 'fetch' })
    .catch(() => undefined)
    .finally(() => fetching.delete(view));
}
export function scheduleAutoFetch(every: Duration | null) {
  if (!every) return undefined;
  const fetching = new Set<string>();
  const fetchAll = () => {
    for (const view of shownViews()) fetchQuietly(view, fetching);
  };
  const timer = setInterval(fetchAll, milliseconds(every));
  return () => clearInterval(timer);
}
