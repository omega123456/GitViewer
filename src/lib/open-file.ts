import { useCallback } from 'react';
import type { Selection } from './types';
import { stopEditing, useSelection } from '../stores/selection';
export function useOpenFile(repo: string) {
  return useCallback(
    (selection: Selection) => useSelection.getState().select(repo, selection),
    [repo],
  );
}
export function useStopEditing(repo: string) {
  return useCallback(() => stopEditing(repo), [repo]);
}
