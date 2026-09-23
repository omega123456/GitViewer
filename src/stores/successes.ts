import { create } from 'zustand';
import type { Success } from '../lib/success';
import { nextNotice } from './errors';
export interface Notice extends Success {
  id: number;
}
interface Successes {
  scopes: Record<string, Notice[]>;
  announce: (scope: string, success: Success) => void;
  dismiss: (scope: string, id: number) => void;
}
const limit = 3;
export const useSuccesses = create<Successes>((set) => {
  const edit = (scope: string, change: (list: Notice[]) => Notice[]) =>
    set((state) => ({
      scopes: { ...state.scopes, [scope]: change(state.scopes[scope] ?? []) },
    }));
  return {
    scopes: {},
    announce: (scope, success) =>
      edit(scope, (list) =>
        [
          ...list.filter(
            (notice) =>
              notice.key !== success.key && notice.key !== success.replaces,
          ),
          { ...success, id: nextNotice() },
        ].slice(-limit),
      ),
    dismiss: (scope, id) =>
      edit(scope, (list) => list.filter((notice) => notice.id !== id)),
  };
});
