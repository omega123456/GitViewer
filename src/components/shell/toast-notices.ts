import { appScope, type Failure } from '../../stores/errors';
import { actionable, type Notice } from '../../stores/successes';
export const ACTIONABLE_TOAST_DURATION_MS = 8000;
export const TOAST_DURATION_MS = 6000;
export type ToastEntry =
  | { scope: string; id: number; failure: Failure }
  | { scope: string; id: number; notice: Notice };
export interface NoticeSources {
  active: string;
  app: Failure[];
  tab: Failure[];
  done: Notice[];
}
export interface NoticeChanges {
  removed: number[];
  added: ToastEntry[];
}
function failureEntries(scope: string, failures: Failure[]): ToastEntry[] {
  return failures.map((failure) => ({
    scope: scope,
    id: failure.id,
    failure: failure,
  }));
}
function noticeEntries(scope: string, notices: Notice[]): ToastEntry[] {
  return notices.map((notice) => ({
    scope: scope,
    id: notice.id,
    notice: notice,
  }));
}
export function toastEntries(sources: NoticeSources): ToastEntry[] {
  const { active, app, tab, done } = sources;
  return [
    ...failureEntries(appScope, app),
    ...failureEntries(active, tab),
    ...noticeEntries(active, done),
  ].sort((left, right) => left.id - right.id);
}
export function diffNotices(
  shown: Iterable<number>,
  entries: ToastEntry[],
): NoticeChanges {
  const shownIds = new Set(shown);
  const currentIds = new Set(entries.map((entry) => entry.id));
  return {
    removed: [...shownIds].filter((id) => !currentIds.has(id)),
    added: entries.filter((entry) => !shownIds.has(entry.id)),
  };
}
function noticeDuration(notice: Notice) {
  if (notice.pending) return Infinity;
  if (actionable(notice)) return ACTIONABLE_TOAST_DURATION_MS;
  return TOAST_DURATION_MS;
}
export function toastDuration(entry: ToastEntry) {
  if ('notice' in entry) return noticeDuration(entry.notice);
  return Infinity;
}
