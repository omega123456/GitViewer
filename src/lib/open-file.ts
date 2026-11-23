import { useCallback } from 'react';
import type { Selection } from './types';
import { useFileTabLimit } from './settings';
import { stopEditing, useSelection } from '../stores/selection';
export function useOpenFile(repo: string) {
  const limit = useFileTabLimit();
  return useCallback(
    (selection: Selection) =>
      useSelection.getState().select(repo, selection, limit),
    [repo, limit],
  );
}
export function useStopEditing(repo: string) {
  const limit = useFileTabLimit();
  return useCallback(() => stopEditing(repo, limit), [repo, limit]);
}
