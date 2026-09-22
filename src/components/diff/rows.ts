import type { Diff, DiffLine } from '../../lib/types';
export interface Row {
  hunk?: number;
  left?: DiffLine;
  right?: DiffLine;
}
export function diffRows(diff: Diff, split: boolean): Row[] {
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
  return diff.hunks.flatMap((hunk, index) => {
    const rows: Row[] = [{ hunk: index }];
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
  });
}
