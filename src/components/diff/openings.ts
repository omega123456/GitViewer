import type { Gap, Opening } from './rows';
export const step = 20;
export type Direction = 'down' | 'up' | 'all';
export type Openings = Record<string, Opening>;
export interface GapRequest {
  gap: Gap;
  direction: Direction;
}
const closedOpening: Opening = { down: 0, up: 0 };
const allLines: Opening = { down: 0, up: Infinity };
const widened: Record<Direction, (opening: Opening) => Opening> = {
  all: (opening) => ({ down: opening.down, up: Infinity }),
  down: (opening) => ({ ...opening, down: opening.down + step }),
  up: (opening) => ({ ...opening, up: opening.up + step }),
};
export function expanded(current: Openings, request: GapRequest): Openings {
  const { gap, direction } = request;
  const opening = current[gap.key] ?? closedOpening;
  return { ...current, [gap.key]: widened[direction](opening) };
}
export function fullyOpened(list: Gap[]): Openings {
  return Object.fromEntries(list.map((gap) => [gap.key, allLines]));
}
export function toggledFull(list: Gap[], full: boolean): Openings {
  return full ? {} : fullyOpened(list);
}
