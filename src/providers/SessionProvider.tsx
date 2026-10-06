import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useEffect, useState, type ReactNode } from 'react';
import { invoke, reportAppError } from '../lib/ipc';
import { joinProject } from '../lib/repository';
import { unsavedNames, useEditor } from '../stores/editor';
import { activeView, useTabs } from '../stores/tabs';
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
        const opened = await Promise.allSettled(
          session.tabs.map((tab) => invoke('repo_open', { path: tab.path })),
        );
        if (cancelled) return;
        let active = session.active;
        let latest = '';
        opened.forEach((result, index) => {
          const tab = session.tabs[index];
          if (result.status === 'rejected') {
            reportAppError(result.reason);
            return;
          }
          const repo = result.value;
          joinProject(repo);
          latest = repo.project;
          if (tab.path === session.active) active = repo.project;
          if (tab.shown) useTabs.getState().show(repo.project, repo.id);
          useTabs.getState().setMessage(repo.id, tab.message);
          if (tab.layout) useLayout.getState().update(repo.id, tab.layout);
        });
        if (latest)
          useTabs
            .getState()
            .activate(
              useTabs.getState().tabs.some((tab) => tab.id === active)
                ? active
                : latest,
            );
      } catch (error) {
        if (!cancelled) reportAppError(error);
      }
      if (cancelled) return;
      let queue = Promise.resolve();
      let closing = false;
      const snapshot = (): Session => {
        const state = useTabs.getState();
        return {
          tabs: state.tabs.flatMap((tab) =>
            tab.members.map((member) => ({
              path: member,
              message: state.messages[member] ?? '',
              layout: tabLayout(member),
              shown: member === tab.view,
            })),
          ),
          active: activeView(),
        };
      };
      const listening = (registration: Promise<() => void>) =>
        registration.catch((error) => {
          if (!cancelled) reportAppError(error);
          return () => {};
        });
      [stopCancelled, unlisten, stopUnsaved] = await Promise.all([
        listening(
          listen('session://close-cancelled', () => {
            closing = false;
          }),
        ),
        listening(
          listen('session://save-requested', () => {
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
          }),
        ),
        listening(
          listen('session://unsaved-edits', () => {
            void confirmQuit();
          }),
        ),
      ]);
      if (cancelled) {
        unlisten();
        stopCancelled();
        stopUnsaved();
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
        if (
          state.tabs === previous.tabs &&
          state.active === previous.active &&
          state.messages === previous.messages
        )
          return;
        save();
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
