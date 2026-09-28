import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { client, connectEvents, perform } from '../lib/query';
import { invoke, normalizeError, reportAppError } from '../lib/ipc';
import { useErrors } from '../stores/errors';
import { useTabs } from '../stores/tabs';
function refresh(repo: string) {
  invoke('refresh', { repo })
    .then(() => useErrors.getState().resolve(repo, 'refresh'))
    .catch((error: unknown) =>
      useErrors.getState().report(repo, normalizeError(error), {
        command: 'refresh',
        retry: () => perform('refresh', { repo }),
      }),
    );
}
export function QueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void connectEvents()
      .then((cleanup) => {
        if (disposed) cleanup();
        else stop = cleanup;
      })
      .catch(reportAppError);
    const focus = () => {
      const { active } = useTabs.getState();
      if (active) refresh(active);
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
