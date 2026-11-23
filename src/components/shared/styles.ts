import type { CSSProperties } from 'react';
const controlStroke =
  'border border-control-stroke dark:border-control-stroke-dark';
const controlFill = 'bg-control dark:bg-control-dark';
export const mutedLabel = 'text-label text-muted dark:text-muted-dark';
export const selectedRow = 'bg-selected dark:bg-selected-dark';
export const accentToggle =
  'bg-selected text-accent dark:bg-selected-dark dark:text-accent-dark';
export const addedInk = 'text-added dark:text-added-dark';
export const removedInk = 'text-deleted dark:text-deleted-dark';
export const dirtyDot =
  'size-1.5 rounded-full bg-modified dark:bg-modified-dark';
export const errorDot =
  'size-1.5 rounded-full bg-error-ink dark:bg-error-ink-dark';
export const iconButton = 'size-6';
export const quietIcon =
  'text-muted hover:text-ink dark:text-muted-dark dark:hover:text-ink-dark';
export const discardIcon =
  'text-muted hover:text-deleted dark:text-muted-dark dark:hover:text-deleted-dark';
export const treeChevron = 'size-3 shrink-0 text-muted dark:text-muted-dark';
export const gutterCell =
  'w-11 shrink-0 bg-gutter px-2 text-right text-label text-faint dark:bg-gutter-dark dark:text-faint-dark';
export const paneHeader =
  'flex h-9.5 shrink-0 items-center gap-1 border-b border-line px-2.5 text-sm dark:border-line-dark';
export const choiceTrack = `inline-flex gap-0.5 rounded-card p-0.5 ${controlStroke} ${controlFill}`;
export const focus =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-outer focus-visible:ring-1 focus-visible:ring-focus-inner dark:focus-visible:outline-focus-outer-dark dark:focus-visible:ring-focus-inner-dark';
export const focusInset =
  'focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-focus-outer focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-inner dark:focus-visible:outline-focus-outer-dark dark:focus-visible:ring-focus-inner-dark';
export const field = `w-full rounded ${controlStroke} ${controlFill} border-b-field-edge px-2.5 placeholder:text-faint hover:bg-control-hover focus:border-b-accent focus:bg-surface focus:shadow-underline focus:outline-none disabled:border-b-control-stroke disabled:bg-track disabled:text-faint aria-invalid:border-b-error-ink aria-invalid:shadow-underline-error dark:border-b-field-edge-dark dark:placeholder:text-faint-dark dark:hover:bg-control-hover-dark dark:focus:border-b-accent-dark dark:focus:bg-surface-dark dark:focus:shadow-underline-dark dark:disabled:border-b-control-stroke-dark dark:disabled:bg-track-dark dark:disabled:text-faint-dark dark:aria-invalid:border-b-error-ink-dark dark:aria-invalid:shadow-underline-error-dark`;
export const searchBox = `flex cursor-pointer items-center gap-2 rounded ${controlStroke} ${controlFill} border-b-field-edge px-2.5 text-sm hover:not-focus-within:bg-control-hover focus-within:border-b-accent focus-within:bg-surface focus-within:shadow-underline dark:border-b-field-edge-dark dark:hover:not-focus-within:bg-control-hover-dark dark:focus-within:border-b-accent-dark dark:focus-within:bg-surface-dark dark:focus-within:shadow-underline-dark`;
export const searchInput =
  'min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint dark:placeholder:text-faint-dark';
export const standard = `${controlStroke} ${controlFill} border-t-control-top border-b-control-edge enabled:hover:bg-control-hover enabled:active:border-control-stroke enabled:active:bg-control-press enabled:active:text-muted dark:border-t-control-top-dark dark:border-b-control-edge-dark dark:enabled:hover:bg-control-hover-dark dark:enabled:active:border-control-stroke-dark dark:enabled:active:bg-control-press-dark dark:enabled:active:text-muted-dark`;
export const clickable = 'enabled:cursor-pointer';
export const flyout =
  'rounded-md border border-flyout-edge bg-flyout text-ink shadow-flyout dark:border-flyout-edge-dark dark:bg-flyout-dark dark:text-ink-dark dark:shadow-flyout-dark';
export const menu = `z-50 flex flex-col py-0.5 ${flyout}`;
const item =
  'mx-1 my-0.5 flex cursor-pointer items-center gap-2.5 rounded px-2.5 text-sm outline-none data-disabled:opacity-40 data-highlighted:bg-hover dark:data-highlighted:bg-hover-dark';
export const menuItem = `h-7.5 ${item}`;
export const selectItem = `relative h-8 ${item}`;
export const menuSeparator = 'my-0.75 h-px bg-line dark:bg-line-dark';
export const pill =
  'absolute top-1/2 left-0 h-4 w-accent -translate-y-1/2 rounded-full bg-accent dark:bg-accent-dark';
export const tabBar =
  'before:absolute before:inset-x-1 before:-top-px before:h-accent before:rounded-b-xs before:bg-accent before:forced-color-adjust-none dark:before:bg-accent-dark forced-colors:before:bg-highlight';
export const revealSlot =
  'pointer-events-none absolute inset-y-0 flex items-center bg-inherit opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100';
export const pinnedSlot = 'absolute inset-y-0 flex items-center bg-inherit';
export const rowTint =
  'hover:bg-hover focus-within:bg-hover dark:hover:bg-hover-dark dark:focus-within:bg-hover-dark';
export function dynamic(
  values: Record<`--${string}`, string | number>,
): CSSProperties {
  return values;
}
