import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useEffect, useState, type ReactNode } from 'react';
import { invoke, reportAppError } from '../lib/ipc';
import { unsavedNames, useEditor } from '../stores/editor';
import { useTabs } from '../stores/tabs';
import { tabLayout, useLayout } from '../stores/layout';
import type { Session } from '../lib/types';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let unsubscribeLayout = () => {};
    let unlisten = () => {};
    let stopCancelled = () => {};
    let stopUnsaved = () => {};
    let unsubscribeEditor = () => {};
    let reported = '';
    let asking = false;
    const confirmQuit = async () => {
      if (asking) return;
      asking = true;
      try {
        const names = unsavedNames();
        if (
          !names.length ||
          (await confirm(
            `Quit and discard unsaved edits to ${names.join(', ')}?`,
            { title: 'Unsaved edits' },
          ))
        )
          await invoke('quit', {});
      } catch (error) {
        reportAppError(error);
      } finally {
        asking = false;
      }
    };
    let settle: ReturnType<typeof setTimeout>;
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
            if (tab.layout) useLayout.getState().update(repo.id, tab.layout);
          } catch (error) {
            reportAppError(error);
          }
        }
        if (cancelled) return;
        if (useTabs.getState().tabs.some((tab) => tab.id === active)) {
          useTabs.getState().activate(active);
        }
      } catch (error) {
        if (!cancelled) reportAppError(error);
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
            layout: tabLayout(tab.id),
          })),
          active: state.active,
        };
      };
      stopCancelled = await listen('session://close-cancelled', () => {
        closing = false;
      }).catch((error) => {
        if (!cancelled) reportAppError(error);
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
            if (!cancelled) reportAppError(error);
          }
        });
      }).catch((error) => {
        if (!cancelled) reportAppError(error);
        return () => {};
      });
      if (cancelled) {
        unlisten();
        stopCancelled();
        return;
      }
      const save = () => {
        if (closing) return;
        const session = snapshot();
        queue = queue.then(async () => {
          try {
            await invoke('session_set', session);
          } catch (error) {
            if (!cancelled) reportAppError(error);
          }
        });
      };
      unsubscribe = useTabs.subscribe((state, previous) => {
        if (state.tabs === previous.tabs && state.active === previous.active)
          return;
        save();
      });
      stopUnsaved = await listen('session://unsaved-edits', () => {
        void confirmQuit();
      }).catch((error) => {
        if (!cancelled) reportAppError(error);
        return () => {};
      });
      unsubscribeEditor = useEditor.subscribe(() => {
        const names = unsavedNames();
        if (names.join('\n') === reported) return;
        reported = names.join('\n');
        invoke('unsaved_set', { paths: names }).catch(reportAppError);
      });
      unsubscribeLayout = useLayout.subscribe(() => {
        clearTimeout(settle);
        settle = setTimeout(save, 200);
      });
      setReady(true);
    };
    void restore();
    return () => {
      cancelled = true;
      clearTimeout(settle);
      unsubscribe();
      unsubscribeLayout();
      unlisten();
      stopCancelled();
      stopUnsaved();
      unsubscribeEditor();
    };
  }, []);
  return ready ? children : null;
}
