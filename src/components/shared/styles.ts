import type { CSSProperties } from 'react';
export const focus =
  'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
export const focusInset =
  'focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2';
export const field = `w-full rounded border border-line bg-surface px-2 py-1 text-sm dark:border-line-dark dark:bg-surface-dark ${focus}`;
export function dynamic(
  values: Record<`--${string}`, string | number>,
): CSSProperties {
  return values as CSSProperties;
}
