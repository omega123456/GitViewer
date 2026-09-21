import { useEffect, useState } from 'react';
import { highlight } from '../../lib/highlight';
import type { Diff } from '../../lib/types';
import { useDark } from '../../stores/theme';
export type Tokens = Record<string, { content: string; color?: string }[]>;
export function useTokens(data: Diff | undefined, path: string) {
  const dark = useDark();
  const [tokens, setTokens] = useState<Tokens>({});
  useEffect(() => {
    let cancelled = false;
    if (data) {
      const lines =
        data.content !== null
          ? data.content
              .split('\n')
              .map((content, index) => ({ content, old: null, new: index + 1 }))
          : data.hunks.flatMap((hunk) => hunk.lines);
      void Promise.all(
        (['old', 'new'] as const).map(async (side) => {
          const selected = lines.filter((line) => line[side] !== null);
          const highlighted = await highlight(
            selected.map((line) => line.content).join('\n'),
            path,
            dark,
          );
          return selected.map(
            (line, index) =>
              [`${side}:${line[side]}`, highlighted[index] ?? []] as const,
          );
        }),
      )
        .then((result) => {
          if (!cancelled) setTokens(Object.fromEntries(result.flat()));
        })
        .catch(() => {
          if (!cancelled) setTokens({});
        });
    }
    return () => {
      cancelled = true;
    };
  }, [data, path, dark]);
  return tokens;
}
