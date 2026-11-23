import type { KeyboardEvent } from 'react';
import { isInside } from '../../lib/browser';
const PAGE_SCROLL_FRACTION = 0.9;

export function scrollPage(event: KeyboardEvent<HTMLDivElement>) {
  if (
    !['PageUp', 'PageDown'].includes(event.key) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    isInside(
      event.target,
      'input, textarea, select, [contenteditable], [role="slider"]',
    )
  )
    return;
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
  event.currentTarget.scrollBy({
    top:
      event.currentTarget.clientHeight *
      PAGE_SCROLL_FRACTION *
      (event.key === 'PageUp' ? -1 : 1),
    behavior: 'instant',
  });
}
