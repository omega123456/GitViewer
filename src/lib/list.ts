export function wrapIndex(index: number, count: number) {
  return ((index % count) + count) % count;
}
export function stepIndex(index: number, direction: number, count: number) {
  return wrapIndex(index + direction, count);
}
