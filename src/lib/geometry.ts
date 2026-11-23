export const FULL_PERCENT = 100;
const HALVES = 2;
export function middleOf(length: number) {
  return length / HALVES;
}
export function percentOf(part: number, whole: number) {
  return (part / whole) * FULL_PERCENT;
}
type Bounds = Pick<DOMRect, 'left' | 'bottom' | 'width' | 'height'>;
const NO_BOUNDS: Bounds = { left: 0, bottom: 0, width: 0, height: 0 };
export function boundsOf(element: Element | null): Bounds {
  return element?.getBoundingClientRect() ?? NO_BOUNDS;
}
