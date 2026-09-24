import type { Diff, DiffLine } from '../../lib/types';
export interface Gap {
  key: string;
  kind: 'top' | 'mid' | 'end';
  start: number;
  end: number | null;
  offset: number;
  hunk: number;
}
export interface Opening {
  down: number;
  up: number;
}
export interface Reveal {
  lines?: string[];
  open: Record<string, Opening>;
}
export interface Row {
  hunk?: number;
  gap?: Gap & { hidden: number | null };
  left?: DiffLine;
  right?: DiffLine;
}
export function gaps(diff: Diff): Gap[] {
  if (diff.content !== null || !diff.hunks.length) return [];
  const result: Gap[] = [];
  diff.hunks.forEach((hunk, index) => {
    const previous = diff.hunks[index - 1];
    const start = previous ? previous.newStart + previous.newCount : 1;
    if (hunk.newStart > start)
      result.push({
        key: `${start}:${hunk.newStart - 1}`,
        kind: previous ? 'mid' : 'top',
        start,
        end: hunk.newStart - 1,
        offset: previous ? previous.oldStart + previous.oldCount - start : 0,
        hunk: index,
      });
  });
  const last = diff.hunks[diff.hunks.length - 1];
  const tail = last.lines.slice(-3);
  if (tail.length === 3 && tail.every((line) => line.kind === 'context')) {
    const start = last.newStart + last.newCount;
    result.push({
      key: `${start}:`,
      kind: 'end',
      start,
      end: null,
      offset: last.oldStart + last.oldCount - start,
      hunk: diff.hunks.length - 1,
    });
  }
  return result;
}
function span(gap: Gap, reveal: Reveal) {
  const end = gap.end ?? reveal.lines?.length ?? null;
  if (end === null) return null;
  const size = Math.max(0, end - gap.start + 1);
  const opening = (reveal.lines && reveal.open[gap.key]) || { down: 0, up: 0 };
  const down = Math.min(size, opening.down);
  const up = Math.min(size - down, opening.up);
  return { end, down, up, hidden: size - down - up };
}
export function hidden(gap: Gap, reveal: Reveal) {
  return span(gap, reveal)?.hidden ?? null;
}
function gapRows(gap: Gap, reveal: Reveal, split: boolean): Row[] {
  const range = span(gap, reveal);
  if (!range) return [{ gap: { ...gap, hidden: null } }];
  const lines = (from: number, count: number) =>
    Array.from({ length: count }, (_, index): Row => {
      const line: DiffLine = {
        kind: 'context',
        content: reveal.lines![from + index - 1] ?? '',
        old: from + index + gap.offset,
        new: from + index,
        noNewline: false,
        marks: [],
      };
      return split ? { left: line, right: line } : { right: line };
    });
  return [
    ...lines(gap.start, range.down),
    ...(range.hidden ? [{ gap: { ...gap, hidden: range.hidden } }] : []),
    ...lines(range.end + 1 - range.up, range.up),
  ];
}
export function diffRows(
  diff: Diff,
  split: boolean,
  reveal: Reveal = { open: {} },
): Row[] {
  if (diff.content !== null)
    return diff.content.split('\n').map((content, index) => ({
      right: {
        kind: diff.added ? 'add' : 'context',
        content,
        old: null,
        new: index + 1,
        noNewline: false,
        marks: [],
      },
    }));
  const all = gaps(diff);
  const before = (index: number, kind: Gap['kind']) =>
    all
      .filter(
        (gap) =>
          gap.hunk === index && (gap.kind === 'end') === (kind === 'end'),
      )
      .flatMap((gap) => gapRows(gap, reveal, split));
  return [
    ...diff.hunks.flatMap((hunk, index) => {
      const rows: Row[] = [...before(index, 'mid'), { hunk: index }];
      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        if (!split) {
          rows.push({ right: line });
          continue;
        }
        if (line.kind === 'context') {
          rows.push({ left: line, right: line });
          continue;
        }
        if (line.kind === 'add') {
          rows.push({ right: line });
          continue;
        }
        const removed: DiffLine[] = [];
        const added: DiffLine[] = [];
        while (i < hunk.lines.length && hunk.lines[i].kind === 'remove')
          removed.push(hunk.lines[i++]);
        while (i < hunk.lines.length && hunk.lines[i].kind === 'add')
          added.push(hunk.lines[i++]);
        i--;
        for (let j = 0; j < Math.max(removed.length, added.length); j++)
          rows.push({ left: removed[j], right: added[j] });
      }
      return rows;
    }),
    ...before(diff.hunks.length - 1, 'end'),
  ];
}
