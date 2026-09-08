import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { client, connectEvents, perform } from '../lib/query';
import { normalizeError } from '../lib/ipc';
import { useTabs } from '../stores/tabs';
export function QueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void connectEvents()
      .then((cleanup) => {
        if (disposed) cleanup();
        else stop = cleanup;
      })
      .catch((error) => useTabs.getState().setError(normalizeError(error)));
    const focus = () => {
      for (const tab of useTabs.getState().tabs)
        void perform('refresh', { repo: tab.id });
    };
    window.addEventListener('focus', focus);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener('focus', focus);
    };
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
