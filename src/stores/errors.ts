import { create } from 'zustand';
import type { GitError } from '../lib/types';
export const appScope = 'app';
export interface Failure {
  id: number;
  error: GitError;
  command?: string;
  retry?: () => Promise<unknown>;
  title?: string;
  lead?: string;
  retryLabel?: string;
}
type Extra = Omit<Failure, 'id' | 'error'>;
interface Errors {
  scopes: Record<string, Failure[]>;
  report: (scope: string, error: GitError, extra?: Extra) => void;
  dismiss: (scope: string, id: number) => void;
  resolve: (scope: string, command: string) => void;
  relabel: (scope: string, command: string, patch: Extra) => void;
}
const limit = 3;
let sequence = 0;
export function nextNotice() {
  return ++sequence;
}
export const useErrors = create<Errors>((set, get) => {
  const edit = (scope: string, change: (list: Failure[]) => Failure[]) =>
    set((state) => ({
      scopes: { ...state.scopes, [scope]: change(state.scopes[scope] ?? []) },
    }));
  return {
    scopes: {},
    report: (scope, error, extra) =>
      edit(scope, (list) =>
        [...list, { ...extra, id: nextNotice(), error }].slice(-limit),
      ),
    dismiss: (scope, id) =>
      edit(scope, (list) => list.filter((failure) => failure.id !== id)),
    resolve: (scope, command) => {
      if (get().scopes[scope]?.some((failure) => failure.command === command))
        edit(scope, (list) =>
          list.filter((failure) => failure.command !== command),
        );
    },
    relabel: (scope, command, patch) =>
      edit(scope, (list) => {
        const last = list
          .filter((failure) => failure.command === command)
          .pop();
        return list.map((failure) =>
          failure === last ? { ...failure, ...patch } : failure,
        );
      }),
  };
});
