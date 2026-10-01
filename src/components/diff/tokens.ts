import { useEffect, useMemo, useRef, useState } from 'react';
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
function joined(entry: Map<string, Tokens>, keys: Record<Side, string>) {
  const key = `${keys.old}\0${keys.new}`;
  const hit = entry.get(key);
  if (hit) return hit;
  const old = entry.get(keys.old);
  const fresh = entry.get(keys.new);
  if (!old || !fresh) return undefined;
  const all = { ...old, ...fresh };
  entry.set(key, all);
  return all;
}
function cached(data: Diff, keys: Record<Side, string>) {
  const entry = cache.get(data);
  return entry && joined(entry, keys);
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
  const shown = useRef(state.tokens);
  useEffect(() => {
    shown.current = state.tokens;
  });
  useEffect(() => {
    if (!enabled || !data || finished) return;
    const keys = { old: oldKey, new: newKey };
    const entry = cache.get(data) ?? new Map<string, Tokens>();
    cache.set(data, entry);
    let display: Tokens | undefined;
    const cancels = (['old', 'new'] as const).map((side) => {
      const lines = sideLines(data, side, text);
      if (!entry.has(keys[side]) && !lines.length) entry.set(keys[side], {});
      if (entry.has(keys[side])) return undefined;
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
          if (done) entry.set(keys[side], progress);
          const all = joined(entry, keys);
          display = all ?? Object.assign(display ?? { ...shown.current }, part);
          setState({
            data,
            full,
            path,
            dark,
            done: Boolean(all),
            tokens: display,
          });
        },
      );
    });
    const all = joined(entry, keys);
    if (all) setState({ data, full, path, dark, done: true, tokens: all });
    return () => cancels.forEach((cancel) => cancel?.());
  }, [data, text, full, path, dark, enabled, finished, oldKey, newKey]);
  return hit ?? state.tokens;
}
