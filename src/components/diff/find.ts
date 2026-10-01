import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { markedTokens } from '../../lib/highlight';
export interface Hit {
  index: number;
  start: number;
  end: number;
}
export interface Found {
  marks: Map<number, [number, number][]>;
  current?: Hit;
}
export function findMatches(texts: string[], query: string): Hit[] {
  if (!query) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'gi',
  );
  return texts.flatMap((text, index) =>
    [...text.matchAll(pattern)].map((match) => ({
      index,
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
}
export function findTokens<T extends { content: string }>(
  tokens: T[],
  found: Found | undefined,
  index: number,
) {
  const current = found?.current;
  return markedTokens(
    markedTokens(tokens, found?.marks.get(index) ?? [], 'found'),
    current?.index === index ? [[current.start, current.end]] : [],
    'current',
  );
}
export function findClass(token: { found: boolean; current: boolean }) {
  return token.current
    ? 'bg-find-current dark:bg-find-current-dark'
    : token.found
      ? 'bg-find dark:bg-find-dark'
      : '';
}
export function useFind(
  texts: () => string[],
  scroll: (index: number) => void,
) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const searched = useDeferredValue(query);
  const lines = useMemo(() => (open ? texts() : []), [open, texts]);
  const hits = useMemo(() => findMatches(lines, searched), [lines, searched]);
  const selected = Math.min(current, hits.length - 1);
  const reveal = useRef(false);
  const latest = useRef(scroll);
  useEffect(() => {
    latest.current = scroll;
  });
  useEffect(() => {
    if (!reveal.current || searched !== query) return;
    reveal.current = false;
    if (hits[0]) latest.current(hits[0].index);
  }, [hits, searched, query]);
  const found = useMemo((): Found | undefined => {
    if (!open) return undefined;
    const marks = new Map<number, [number, number][]>();
    for (const hit of hits) {
      const line = marks.get(hit.index) ?? [];
      line.push([hit.start, hit.end]);
      marks.set(hit.index, line);
    }
    return { marks, current: hits[selected] };
  }, [open, hits, selected]);
  return {
    input,
    open,
    query,
    count: hits.length,
    selected,
    found,
    reveal: () => {
      setOpen(true);
      input.current?.focus();
      input.current?.select();
    },
    close: () => setOpen(false),
    search: (value: string) => {
      setQuery(value);
      setCurrent(0);
      reveal.current = true;
    },
    step: (direction: number) => {
      const latestHits = searched === query ? hits : findMatches(lines, query);
      if (!latestHits.length) return;
      reveal.current = false;
      const at = Math.min(current, latestHits.length - 1);
      const next = (at + direction + latestHits.length) % latestHits.length;
      setCurrent(next);
      scroll(latestHits[next].index);
    },
  };
}
export type Find = ReturnType<typeof useFind>;
