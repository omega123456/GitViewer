import { create } from 'zustand';
import { withEntry } from '../lib/record';
export const NOTICE_LIMIT = 3;
interface Identified {
  id: number;
}
type Change<T> = (list: T[]) => T[];
export interface NoticeTools<T> {
  edit: (scope: string, change: Change<T>) => void;
  listOf: (scope: string) => T[] | undefined;
}
export interface NoticeState<T> {
  scopes: Record<string, T[]>;
  dismiss: (scope: string, id: number) => void;
}
let sequence = 0;
export function nextNotice() {
  return ++sequence;
}
export function createNoticeStore<T extends Identified, Actions>(
  buildActions: (tools: NoticeTools<T>) => Actions,
) {
  return create<NoticeState<T> & Actions>((set, get) => {
    const edit = (scope: string, change: Change<T>) =>
      set((state) => ({
        ...state,
        scopes: withEntry(
          state.scopes,
          scope,
          change(state.scopes[scope] ?? []),
        ),
      }));
    const listOf = (scope: string) => get().scopes[scope];
    return {
      scopes: {},
      dismiss: (scope: string, id: number) =>
        edit(scope, (list) => list.filter((notice) => notice.id !== id)),
      ...buildActions({ edit, listOf }),
    };
  });
}
