import type { KeyboardEvent } from 'react';

export function scrollPage(event: KeyboardEvent<HTMLDivElement>) {
  if (
    !['PageUp', 'PageDown'].includes(event.key) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    (event.target as HTMLElement).closest(
      'input, textarea, select, [contenteditable], [role="slider"]',
    )
  )
    return;
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
  event.currentTarget.scrollBy({
    top:
      event.currentTarget.clientHeight *
      0.9 *
      (event.key === 'PageUp' ? -1 : 1),
    behavior: 'instant',
  });
}
