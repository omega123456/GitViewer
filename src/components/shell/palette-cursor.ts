import { stepIndex } from '../../lib/list';
export interface PaletteCursor {
  filter: string;
  index: number;
}
export interface CursorStep {
  delta: number;
  count: number;
}
export const emptyCursor: PaletteCursor = { filter: '', index: 0 };
export function searched(filter: string): PaletteCursor {
  return { filter: filter, index: 0 };
}
function clampedIndex(index: number, count: number) {
  return Math.min(index, count - 1);
}
export function moved(cursor: PaletteCursor, step: CursorStep): PaletteCursor {
  const { delta, count } = step;
  if (!count) return { ...cursor, index: 0 };
  const index = stepIndex(clampedIndex(cursor.index, count), delta, count);
  return { ...cursor, index: index };
}
export function paged(cursor: PaletteCursor, step: CursorStep): PaletteCursor {
  const { delta, count } = step;
  const target = clampedIndex(cursor.index, count) + delta;
  const index = Math.max(0, Math.min(count - 1, target));
  return { ...cursor, index: index };
}
export function pointedAt(cursor: PaletteCursor, index: number): PaletteCursor {
  return { ...cursor, index: index };
}
