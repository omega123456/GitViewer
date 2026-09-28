import { useEffect, useMemo, useState } from 'react';
import { tokenize } from '../../lib/highlight';
import type { Diff } from '../../lib/types';
import { useDark } from '../../stores/theme';
export type Tokens = Record<string, { content: string; color?: string }[]>;
type Side = 'old' | 'new';
const none: Tokens = {};
const cache = new WeakMap<Diff, Map<string, Tokens>>();
interface Highlighted {
  data?: Diff;
  full?: string;
  path: string;
  dark: boolean;
  done: boolean;
  tokens: Tokens;
}
function sideLines(data: Diff, side: Side, text?: string[]) {
  if (side === 'new' && text)
    return text.map((content, index) => ({ content, line: index + 1 }));
  if (data.content !== null)
    return side === 'old'
      ? []
      : data.content
          .split('\n')
          .map((content, index) => ({ content, line: index + 1 }));
  return data.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line) =>
      line[side] === null ? [] : [{ content: line.content, line: line[side] }],
    ),
  );
}
function cached(data: Diff, keys: Record<Side, string>) {
  const entry = cache.get(data);
  const old = entry?.get(keys.old);
  const fresh = entry?.get(keys.new);
  return old && fresh ? { ...old, ...fresh } : undefined;
}
export function useTokens(
  data: Diff | undefined,
  path: string,
  enabled = true,
  text?: string[],
) {
  const dark = useDark();
  const full = useMemo(() => text?.join('\n'), [text]);
  const base = `${dark ? 'dark' : 'light'}\n${path}`;
  const oldKey = `${base}\nold`;
  const newKey = full === undefined ? `${base}\nnew` : `${base}\nfull\n${full}`;
  const [state, setState] = useState<Highlighted>({
    path,
    dark,
    done: false,
    tokens: none,
  });
  const current =
    state.data === data &&
    state.full === full &&
    state.path === path &&
    state.dark === dark;
  const hit =
    !current && data ? cached(data, { old: oldKey, new: newKey }) : undefined;
  if (hit) setState({ data, full, path, dark, done: true, tokens: hit });
  else if (!enabled && !current && state.tokens !== none)
    setState({ path, dark, done: false, tokens: none });
  const finished = current && state.done;
  useEffect(() => {
    if (!enabled || !data || finished) return;
    const keys = { old: oldKey, new: newKey };
    const entry = cache.get(data) ?? new Map<string, Tokens>();
    cache.set(data, entry);
    const complete: Partial<Record<Side, Tokens>> = {};
    const merged = () =>
      complete.old && complete.new
        ? { ...complete.old, ...complete.new }
        : undefined;
    const cancels = (['old', 'new'] as const).map((side) => {
      const lines = sideLines(data, side, text);
      complete[side] = entry.get(keys[side]) ?? (lines.length ? undefined : {});
      if (complete[side]) return undefined;
      const progress: Tokens = {};
      return tokenize(
        lines.map((line) => line.content),
        path,
        dark,
        (start, chunk, done) => {
          const part = Object.fromEntries(
            chunk.map((tokens, index) => [
              `${side}:${lines[start + index].line}`,
              tokens,
            ]),
          );
          Object.assign(progress, part);
          if (done) {
            complete[side] = progress;
            entry.set(keys[side], progress);
          }
          const all = merged();
          setState((previous) => ({
            data,
            full,
            path,
            dark,
            done: Boolean(all),
            tokens: all ?? { ...previous.tokens, ...part },
          }));
        },
      );
    });
    const all = merged();
    if (all) setState({ data, full, path, dark, done: true, tokens: all });
    return () => cancels.forEach((cancel) => cancel?.());
  }, [data, text, full, path, dark, enabled, finished, oldKey, newKey]);
  return hit ?? state.tokens;
}
