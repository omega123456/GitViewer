import type { Success } from '../lib/success';
import { createNoticeStore, nextNotice, NOTICE_LIMIT } from './notices';
export interface Notice extends Success {
  id: number;
}
export type Announcement = Omit<Success, 'key'>;
function actionable(notice: Notice) {
  return Boolean(notice.restore || notice.unapply || notice.show);
}
function trim(list: Notice[]) {
  const older = list.slice(0, -1);
  const evictable = [
    ...older.filter((notice) => !actionable(notice)),
    ...older.filter(actionable),
  ];
  const overflow = Math.max(0, list.length - NOTICE_LIMIT);
  const evicted = new Set(evictable.slice(0, overflow));
  return list.filter((notice) => !evicted.has(notice));
}
export const useSuccesses = createNoticeStore<
  Notice,
  {
    announce: (scope: string, success: Success) => void;
    withdraw: (scope: string, key: string) => void;
  }
>(({ edit }) => ({
  announce: (scope, success) =>
    edit(scope, (list) =>
      trim([
        ...list.filter(
          (notice) =>
            notice.key !== success.key && notice.key !== success.replaces,
        ),
        { ...success, id: nextNotice() },
      ]),
    ),
  withdraw: (scope, key) =>
    edit(scope, (list) => list.filter((notice) => notice.key !== key)),
}));
export function announceInfo(
  scope: string,
  key: string,
  announcement: Announcement,
) {
  useSuccesses
    .getState()
    .announce(scope, { key: key, info: true, ...announcement });
}
export function announcer(scope: string, key: string) {
  return (announcement: Announcement) => announceInfo(scope, key, announcement);
}
