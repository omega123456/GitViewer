import { useEffect, useRef, useState } from 'react';
import { tokenize } from '../../lib/highlight';
import { useBackend } from '../../lib/query';
import type { Diff } from '../../lib/types';
import { useDark } from '../../lib/theme';
import { splitLines } from './expansion';
import {
  highlighted,
  idleHighlight,
  noTokens,
  sameInputs,
  type Highlighted,
  type HighlightInputs,
  type Tokens,
} from './highlight-state';
import type { DiffTarget } from './target';
export type { Tokens } from './highlight-state';
type Side = 'old' | 'new';
type FileTarget = Omit<DiffTarget, 'data'>;
const cache = new WeakMap<Diff, Map<string, Tokens>>();
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
          .map((content, index) => ({ content: content, line: index + 1 }));
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
    .map((content, index) => ({ content: content, line: index + 1 }));
}
function useSideText(target: FileTarget, side: Side, enabled: boolean) {
  const { repo, selection } = target;
  const args = {
    repo: repo,
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
export function useTokens(target: DiffTarget, enabled = true) {
  const { data, selection } = target;
  const dark = useDark();
  const path = selection.path;
  const old = useSideText(target, 'old', enabled && needed(data, 'old'));
  const fresh = useSideText(target, 'new', enabled && needed(data, 'new'));
  const oldText = old.text;
  const newText = fresh.text;
  const settled = old.settled && fresh.settled;
  const base = `${dark ? 'dark' : 'light'}\n${path}`;
  const oldKey = sideKey(base, 'old', oldText);
  const newKey = sideKey(base, 'new', newText);
  const [state, setState] = useState<Highlighted>(() =>
    idleHighlight(path, dark),
  );
  const inputs: HighlightInputs = {
    data: data,
    oldText: oldText,
    newText: newText,
    path: path,
    dark: dark,
  };
  const current = sameInputs(state.inputs, inputs);
  const hit =
    !current && data && settled
      ? cached(data, { old: oldKey, new: newKey })
      : undefined;
  if (hit) setState(highlighted(inputs, hit, true));
  else if (!enabled && !current && state.tokens !== noTokens)
    setState(idleHighlight(path, dark));
  const finished = current && state.done;
  const shown = useRef(state.tokens);
  useEffect(() => {
    shown.current = state.tokens;
  });
  useEffect(() => {
    if (!enabled || !data || !settled || finished) return;
    const latest: HighlightInputs = {
      data: data,
      oldText: oldText,
      newText: newText,
      path: path,
      dark: dark,
    };
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
      const job = {
        lines: lines.map((line) => line.content),
        path: path,
        dark: dark,
      };
      return tokenize(job, (start, chunk, done) => {
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
        setState(highlighted(latest, display, Boolean(all)));
      });
    });
    const all = joined(entry, keys);
    if (all) setState(highlighted(latest, all, true));
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
