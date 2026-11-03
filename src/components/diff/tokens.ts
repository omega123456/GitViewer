import { useEffect, useRef, useState } from 'react';
import { tokenize } from '../../lib/highlight';
import { useBackend } from '../../lib/query';
import type { Diff, Selection } from '../../lib/types';
import { useDark } from '../../stores/theme';
import { splitLines } from './expansion';
export type Tokens = Record<string, { content: string; color?: string }[]>;
type Side = 'old' | 'new';
const none: Tokens = {};
const cache = new WeakMap<Diff, Map<string, Tokens>>();
interface Highlighted {
  data?: Diff;
  oldText?: string;
  newText?: string;
  path: string;
  dark: boolean;
  done: boolean;
  tokens: Tokens;
}
function needed(data: Diff | undefined, side: Side) {
  return Boolean(
    data &&
    data.content === null &&
    data.hunks.some((hunk) =>
      hunk.lines.some((line) =>
        side === 'old' ? line.kind === 'remove' : line.new !== null,
      ),
    ),
  );
}
function sideLines(data: Diff, side: Side, text?: string) {
  if (data.content !== null)
    return side === 'old'
      ? []
      : data.content
          .split('\n')
          .map((content, index) => ({ content, line: index + 1 }));
  if (!needed(data, side)) return [];
  const shown = data.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line) =>
      line[side] === null ? [] : [{ content: line.content, line: line[side] }],
    ),
  );
  const file = text === undefined ? undefined : splitLines(text);
  if (
    !file ||
    shown.some(
      (line) => file[line.line - 1] !== line.content.replace(/\r$/, ''),
    )
  )
    return shown;
  const end = side === 'old' ? shown[shown.length - 1].line : file.length;
  return file
    .slice(0, end)
    .map((content, index) => ({ content, line: index + 1 }));
}
function useSideText(
  repo: string,
  selection: Selection,
  side: Side,
  enabled: boolean,
) {
  const args = {
    repo,
    path: selection.path,
    source: selection.source,
    revision: selection.revision,
    base: selection.base,
  };
  const query = useBackend(
    'file_lines',
    side === 'old' ? { ...args, old: true } : args,
    enabled,
  );
  return {
    text: typeof query.data === 'string' ? query.data : undefined,
    settled: !enabled || query.data !== undefined || query.isError,
  };
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
function sideKey(base: string, side: Side, text?: string) {
  return text === undefined ? `${base}\n${side}` : `${base}\n${side}\n${text}`;
}
export function useTokens(
  repo: string,
  selection: Selection,
  data: Diff | undefined,
  enabled = true,
) {
  const dark = useDark();
  const path = selection.path;
  const old = useSideText(
    repo,
    selection,
    'old',
    enabled && needed(data, 'old'),
  );
  const fresh = useSideText(
    repo,
    selection,
    'new',
    enabled && needed(data, 'new'),
  );
  const oldText = old.text;
  const newText = fresh.text;
  const settled = old.settled && fresh.settled;
  const base = `${dark ? 'dark' : 'light'}\n${path}`;
  const oldKey = sideKey(base, 'old', oldText);
  const newKey = sideKey(base, 'new', newText);
  const [state, setState] = useState<Highlighted>({
    path,
    dark,
    done: false,
    tokens: none,
  });
  const current =
    state.data === data &&
    state.oldText === oldText &&
    state.newText === newText &&
    state.path === path &&
    state.dark === dark;
  const hit =
    !current && data && settled
      ? cached(data, { old: oldKey, new: newKey })
      : undefined;
  if (hit)
    setState({ data, oldText, newText, path, dark, done: true, tokens: hit });
  else if (!enabled && !current && state.tokens !== none)
    setState({ path, dark, done: false, tokens: none });
  const finished = current && state.done;
  const shown = useRef(state.tokens);
  useEffect(() => {
    shown.current = state.tokens;
  });
  useEffect(() => {
    if (!enabled || !data || !settled || finished) return;
    const keys = { old: oldKey, new: newKey };
    const texts = { old: oldText, new: newText };
    const entry = cache.get(data) ?? new Map<string, Tokens>();
    cache.set(data, entry);
    let display: Tokens | undefined;
    const cancels = (['old', 'new'] as const).map((side) => {
      const lines = sideLines(data, side, texts[side]);
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
            oldText,
            newText,
            path,
            dark,
            done: Boolean(all),
            tokens: display,
          });
        },
      );
    });
    const all = joined(entry, keys);
    if (all)
      setState({ data, oldText, newText, path, dark, done: true, tokens: all });
    return () => cancels.forEach((cancel) => cancel?.());
  }, [
    data,
    oldText,
    newText,
    settled,
    path,
    dark,
    enabled,
    finished,
    oldKey,
    newKey,
  ]);
  return hit ?? state.tokens;
}
