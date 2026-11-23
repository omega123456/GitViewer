import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useBackend } from '../../lib/query';
import { gaps, hidden, type Gap, type Reveal } from './rows';
import {
  expanded,
  toggledFull,
  type Direction,
  type Openings,
} from './openings';
import type { DiffTarget } from './target';
export { step, type Direction, type Openings } from './openings';
export interface OpeningsControl {
  openings: Openings;
  setOpenings: Dispatch<SetStateAction<Openings>>;
}
export function splitLines(text: string) {
  const split = text.split(/\r?\n/);
  if (split[split.length - 1] === '') split.pop();
  return split;
}
export interface Expansion {
  reveal: Reveal;
  available: boolean;
  full: boolean;
  loading: boolean;
  tooLarge: boolean;
  expand: (gap: Gap, direction: Direction) => void;
  toggleFull: () => void;
}
function loadedLines(wanted: boolean, data: string | null | undefined) {
  if (!wanted || typeof data !== 'string') return undefined;
  return splitLines(data);
}
function isFullyExpanded(
  lines: string[] | undefined,
  list: Gap[],
  reveal: Reveal,
) {
  if (lines === undefined || list.length === 0) return false;
  return list.every((gap) => hidden(gap, reveal) === 0);
}
export function useExpansion(
  target: DiffTarget,
  controlled?: OpeningsControl,
): Expansion {
  const { repo, selection, data } = target;
  const [localOpenings, setLocalOpenings] = useState<Openings>({});
  const open = controlled?.openings ?? localOpenings;
  const setOpen = controlled?.setOpenings ?? setLocalOpenings;
  const list = useMemo(() => (data ? gaps(data) : []), [data]);
  const wanted = list.length > 0 && Object.keys(open).length > 0;
  const text = useBackend(
    'file_lines',
    {
      repo: repo,
      path: selection.path,
      source: selection.source,
      revision: selection.revision,
      base: selection.base,
    },
    wanted,
  );
  const lines = useMemo(
    () => loadedLines(wanted, text.data),
    [wanted, text.data],
  );
  const reveal = useMemo(() => ({ lines, open }), [lines, open]);
  const full = isFullyExpanded(lines, list, reveal);
  const loading = wanted && text.isFetching && text.data === undefined;
  return {
    reveal: reveal,
    available: list.length > 0,
    full: full,
    loading: loading,
    tooLarge: wanted && text.data === null,
    expand: (gap, direction) => {
      if (text.isError) void text.refetch();
      setOpen((current) =>
        expanded(current, { gap: gap, direction: direction }),
      );
    },
    toggleFull: () => {
      if (text.isError) void text.refetch();
      setOpen(toggledFull(list, full));
    },
  };
}
