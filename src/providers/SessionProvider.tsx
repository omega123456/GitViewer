import { listen } from '@tauri-apps/api/event';
import { useEffect, useState, type ReactNode } from 'react';
import { invoke, normalizeError } from '../lib/ipc';
import { useTabs } from '../stores/tabs';
import type { Session } from '../lib/types';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let unlisten = () => {};
    let stopCancelled = () => {};
    const restore = async () => {
      try {
        const session = await invoke('session_get', {});
        let active = session.active;
        for (const tab of session.tabs) {
          if (cancelled) return;
          try {
            const repo = await invoke('repo_open', { path: tab.path });
            if (cancelled) return;
            if (tab.path === session.active) active = repo.id;
            useTabs.getState().open(repo.id, repo.name);
            useTabs.getState().setMessage(repo.id, tab.message);
          } catch (error) {
            useTabs.getState().setError(normalizeError(error));
          }
        }
        if (cancelled) return;
        if (useTabs.getState().tabs.some((tab) => tab.id === active)) {
          useTabs.getState().activate(active);
        }
      } catch (error) {
        if (!cancelled) useTabs.getState().setError(normalizeError(error));
      }
      if (cancelled) return;
      let queue = Promise.resolve();
      let closing = false;
      const snapshot = (): Session => {
        const state = useTabs.getState();
        return {
          tabs: state.tabs.map((tab) => ({
            path: tab.id,
            message: tab.message,
          })),
          active: state.active,
        };
      };
      stopCancelled = await listen('session://close-cancelled', () => {
        closing = false;
      }).catch((error) => {
        if (!cancelled) useTabs.getState().setError(normalizeError(error));
        return () => {};
      });
      unlisten = await listen('session://save-requested', () => {
        if (closing || cancelled) return;
        closing = true;
        const session = snapshot();
        queue = queue.then(async () => {
          try {
            await invoke('session_close', session);
          } catch (error) {
            closing = false;
            if (!cancelled) useTabs.getState().setError(normalizeError(error));
          }
        });
      }).catch((error) => {
        if (!cancelled) useTabs.getState().setError(normalizeError(error));
        return () => {};
      });
      if (cancelled) {
        unlisten();
        stopCancelled();
        return;
      }
      unsubscribe = useTabs.subscribe((state, previous) => {
        if (closing) return;
        if (state.tabs === previous.tabs && state.active === previous.active)
          return;
        const session = snapshot();
        queue = queue.then(async () => {
          try {
            await invoke('session_set', session);
          } catch (error) {
            if (!cancelled) useTabs.getState().setError(normalizeError(error));
          }
        });
      });
      setReady(true);
    };
    void restore();
    return () => {
      cancelled = true;
      unsubscribe();
      unlisten();
      stopCancelled();
    };
  }, []);
  return ready ? children : null;
}
