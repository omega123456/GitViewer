import { useEffect } from 'react';
import { invoke, normalizeError } from './ipc';

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
    const report = (message: string) => {
      void invoke('frontend_log', { message }).catch(() => {});
    };
    const error = (event: ErrorEvent) => report(event.message);
    const rejection = (event: PromiseRejectionEvent) =>
      report(normalizeError(event.reason).message);
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', rejection);
    const prevent = (event: Event) => event.preventDefault();
    const context = (event: Event) => {
      event.preventDefault();
      if (
        event.target instanceof Element &&
        event.target.closest(
          'textarea, input:not([type="checkbox"], [type="range"]), [contenteditable="true"]',
        )
      )
        void invoke('edit_menu', {}).catch(() => {});
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    document.addEventListener('contextmenu', context);
    document.addEventListener('dragstart', prevent);
    document.addEventListener('drop', prevent);
    document.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.removeEventListener('error', error);
      window.removeEventListener('unhandledrejection', rejection);
      document.removeEventListener('contextmenu', context);
      document.removeEventListener('dragstart', prevent);
      document.removeEventListener('drop', prevent);
      document.removeEventListener('wheel', wheel);
    };
  }, []);
}
