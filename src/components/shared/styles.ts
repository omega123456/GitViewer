import type { CSSProperties } from 'react';
export const focus =
  'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
export const focusInset =
  'focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2';
export const field = `w-full rounded border border-line bg-surface px-2 py-1 text-sm aria-invalid:border-error-ink aria-invalid:ring-3 aria-invalid:ring-error dark:border-line-dark dark:bg-surface-dark dark:aria-invalid:border-error-ink-dark dark:aria-invalid:ring-error-dark ${focus}`;
export const revealSlot =
  'pointer-events-none absolute inset-y-0 flex items-center bg-inherit opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100';
export const pinnedSlot = 'absolute inset-y-0 flex items-center bg-inherit';
export const rowTint =
  'hover:bg-hover focus-within:bg-hover dark:hover:bg-hover-dark dark:focus-within:bg-hover-dark';
export function dynamic(
  values: Record<`--${string}`, string | number>,
): CSSProperties {
  return values as CSSProperties;
}
