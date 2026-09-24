import { useMemo, useState } from 'react';
import { useBackend } from '../../lib/query';
import type { Diff, Selection } from '../../lib/types';
import { gaps, hidden, type Gap, type Opening, type Reveal } from './rows';
export const step = 20;
export type Direction = 'down' | 'up' | 'all';
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
  repo: string,
  selection: Selection,
  data: Diff | undefined,
): Expansion {
  const [open, setOpen] = useState<Record<string, Opening>>({});
  const list = useMemo(() => (data ? gaps(data) : []), [data]);
  const wanted = list.length > 0 && Object.keys(open).length > 0;
  const text = useBackend(
    'file_lines',
    {
      repo,
      path: selection.path,
      source: selection.source,
      revision: selection.revision,
      base: selection.base,
    },
    wanted,
  );
  const lines = useMemo(() => {
    if (typeof text.data !== 'string') return undefined;
    const split = text.data.split(/\r?\n/);
    if (split[split.length - 1] === '') split.pop();
    return split;
  }, [text.data]);
  const reveal = useMemo(() => ({ lines, open }), [lines, open]);
  const full =
    lines !== undefined &&
    list.length > 0 &&
    list.every((gap) => hidden(gap, reveal) === 0);
  return {
    reveal,
    available: list.length > 0,
    full,
    loading: wanted && text.isFetching && text.data === undefined,
    tooLarge: text.data === null,
    expand: (gap, direction) => {
      if (text.isError) void text.refetch();
      setOpen((current) => {
        const opening = current[gap.key] ?? { down: 0, up: 0 };
        return {
          ...current,
          [gap.key]:
            direction === 'all'
              ? { down: opening.down, up: Infinity }
              : direction === 'down'
                ? { ...opening, down: opening.down + step }
                : { ...opening, up: opening.up + step },
        };
      });
    },
    toggleFull: () => {
      if (text.isError) void text.refetch();
      setOpen(
        full
          ? {}
          : Object.fromEntries(
              list.map((gap) => [gap.key, { down: 0, up: Infinity }]),
            ),
      );
    },
  };
}
