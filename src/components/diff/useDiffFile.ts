import { useCallback, useMemo } from 'react';
import type { Diff, Selection, Settings } from '../../lib/types';
import { useDiffView } from '../../stores/diff-view';
import { runHunkAction } from './hunks';
import { diffRows, type Reveal } from './rows';
export interface ChangeCounts {
  added: number;
  removed: number;
}
export function countChanges(data: Diff | undefined): ChangeCounts {
  const lines = data?.hunks.flatMap((hunk) => hunk.lines) ?? [];
  return {
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'remove').length,
  };
}
export interface DiffFileSource {
  repo: string;
  selection: Selection;
  data: Diff | undefined;
  reveal: Reveal;
  defaultMode: Settings['diffMode'];
}
export function useDiffFile({
  repo,
  selection,
  data,
  reveal,
  defaultMode,
}: DiffFileSource) {
  const mode = useDiffView((state) => state.mode) ?? defaultMode;
  const split = mode === 'split' && data?.content === null;
  const rows = useMemo(
    () => (data ? diffRows(data, split, reveal) : []),
    [data, split, reveal],
  );
  const counts = useMemo(() => countChanges(data), [data]);
  const hunkAction = useCallback(
    (hunk: number, action: string) => {
      if (!data) return;
      void runHunkAction(repo, selection, data, hunk, action);
    },
    [repo, selection, data],
  );
  return { mode, split, rows, counts, hunkAction };
}
