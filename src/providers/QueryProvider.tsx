import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { client, connectEvents, perform } from '../lib/query';
import { invoke, reportAppError } from '../lib/ipc';
import { activeTab, activeView, anchorOf } from '../stores/tabs';
function refresh(repo: string) {
  void perform('refresh', { repo }, { run: invoke });
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
      const tab = activeTab();
      if (!tab) return;
      const view = activeView();
      refresh(view);
      if (anchorOf(tab) !== view) refresh(anchorOf(tab));
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
