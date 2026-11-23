import type { GitError } from '../lib/types';
import { createNoticeStore, nextNotice, NOTICE_LIMIT } from './notices';
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
export function relabeled(list: Failure[], command: string, patch: Extra) {
  const last = list.filter((failure) => failure.command === command).pop();
  return list.map((failure) =>
    failure === last ? { ...failure, ...patch } : failure,
  );
}
export const useErrors = createNoticeStore<
  Failure,
  {
    report: (scope: string, error: GitError, extra?: Extra) => void;
    resolve: (scope: string, command: string) => void;
    relabel: (scope: string, command: string, patch: Extra) => void;
  }
>(({ edit, listOf }) => ({
  report: (scope, error, extra) =>
    edit(scope, (list) =>
      [...list, { ...extra, id: nextNotice(), error: error }].slice(
        -NOTICE_LIMIT,
      ),
    ),
  resolve: (scope, command) => {
    if (listOf(scope)?.some((failure) => failure.command === command))
      edit(scope, (list) =>
        list.filter((failure) => failure.command !== command),
      );
  },
  relabel: (scope, command, patch) =>
    edit(scope, (list) => relabeled(list, command, patch)),
}));
