import { useEffect, useState } from 'react';
import { highlight } from '../../lib/highlight';
import type { Diff } from '../../lib/types';
import { useDark } from '../../stores/theme';
export type Tokens = Record<string, { content: string; color?: string }[]>;
const none: Tokens = {};
interface Highlighted {
  data?: Diff;
  path: string;
  dark: boolean;
  tokens: Tokens;
}
export function useTokens(
  data: Diff | undefined,
  path: string,
  enabled = true,
) {
  const dark = useDark();
  const [state, setState] = useState<Highlighted>({ path, dark, tokens: none });
  const current =
    state.data === data && state.path === path && state.dark === dark;
  if (!enabled && !current && state.tokens !== none)
    setState({ path, dark, tokens: none });
  useEffect(() => {
    if (!enabled || !data || current) return;
    let cancelled = false;
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
        if (!cancelled)
          setState({
            data,
            path,
            dark,
            tokens: Object.fromEntries(result.flat()),
          });
      })
      .catch(() => {
        if (!cancelled) setState({ data, path, dark, tokens: none });
      });
    return () => {
      cancelled = true;
    };
  }, [data, path, dark, enabled, current]);
  return state.tokens;
}
