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
    () =>
      wanted && typeof text.data === 'string'
        ? splitLines(text.data)
        : undefined,
    [wanted, text.data],
  );
  const reveal = useMemo(() => ({ lines, open }), [lines, open]);
  const full =
    lines !== undefined &&
    list.length > 0 &&
    list.every((gap) => hidden(gap, reveal) === 0);
  return {
    reveal: reveal,
    available: list.length > 0,
    full: full,
    loading: wanted && text.isFetching && text.data === undefined,
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
