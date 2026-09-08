import { useEffect } from 'react';

export function preventBrowserShortcut(event: KeyboardEvent) {
  const editable =
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));
  const key = event.key.toLowerCase();
  if (
    key === 'f5' ||
    key === 'f12' ||
    ((event.metaKey || event.ctrlKey) &&
      ['r', 'p', 's', 'f', 'g', 'o', 'l', '+', '=', '-', '0'].includes(key)) ||
    (event.altKey && ['arrowleft', 'arrowright'].includes(key)) ||
    (!editable && key === 'backspace')
  )
    event.preventDefault();
}

export function useBrowserRestrictions() {
  useEffect(() => {
    const prevent = (event: Event) => event.preventDefault();
    const context = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, [contenteditable="true"], .file-content',
        )
      )
        return;
      event.preventDefault();
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    document.addEventListener('contextmenu', context);
    document.addEventListener('dragstart', prevent);
    document.addEventListener('drop', prevent);
    document.addEventListener('wheel', wheel, { passive: false });
    return () => {
      document.removeEventListener('contextmenu', context);
      document.removeEventListener('dragstart', prevent);
      document.removeEventListener('drop', prevent);
      document.removeEventListener('wheel', wheel);
    };
  }, []);
}
