import { Activity, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { milliseconds, type Duration } from 'date-fns';
import { UpdateBanner } from '../states/UpdateBanner';
import type { Settings, SettingsResponse } from '../../lib/types';
import { invoke, reportAppError } from '../../lib/ipc';
import { folderName } from '../../lib/paths';
import { mica } from '../../lib/platform';
import { useCompact } from '../../stores/density';
import { useActiveView, useTabs } from '../../stores/tabs';
import { useDark } from '../../stores/theme';
import { SettingsSurface } from '../settings/SettingsSurface';
import { FirstRun } from '../states/FirstRun';
import { CommandPalette } from './CommandPalette';
import { RepoTabStrip } from './RepoTabStrip';
import { RepositoryView } from './RepositoryView';
import { Toaster } from './Toaster';
const fetchEvery: Partial<Record<Settings['autoFetchInterval'], Duration>> = {
  '30s': { seconds: 30 },
  '1m': { minutes: 1 },
  '5m': { minutes: 5 },
  '10m': { minutes: 10 },
  '15m': { minutes: 15 },
  '30m': { minutes: 30 },
};
export function AppShell({
  settings,
  version,
}: {
  settings: SettingsResponse;
  version: string;
}) {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const view = useActiveView();
  const multiple = useTabs(
    (s) => (s.tabs.find((tab) => tab.id === s.active)?.members.length ?? 0) > 1,
  );
  const project = useTabs(
    (s) => s.tabs.find((tab) => tab.id === s.active)?.name,
  );
  const dark = useDark();
  const compact = useCompact();
  useEffect(() => {
    getCurrentWindow()
      .setTitle(project ? `${project} — GitViewer` : 'GitViewer')
      .catch(reportAppError);
  }, [project]);
  const every = fetchEvery[settings.autoFetchInterval];
  useEffect(() => {
    if (!every) return;
    const fetching = new Set<string>();
    const timer = setInterval(() => {
      for (const { view } of useTabs.getState().tabs) {
        if (fetching.has(view)) continue;
        fetching.add(view);
        invoke('sync', { repo: view, action: 'fetch' })
          .catch(() => undefined)
          .finally(() => fetching.delete(view));
      }
    }, milliseconds(every));
    return () => clearInterval(timer);
  }, [every]);
  return (
    <main
      data-theme={dark ? 'dark' : 'light'}
      data-density={compact ? 'compact' : 'comfortable'}
      className={`relative flex h-screen flex-col overflow-hidden font-sans text-ink dark:text-ink-dark ${mica() ? 'bg-transparent' : 'bg-surface dark:bg-surface-dark'}`}
    >
      <RepoTabStrip />
      <div className="flex min-h-0 flex-1 flex-col bg-surface dark:bg-surface-dark">
        <UpdateBanner />
        {tabs.length === 0 ? (
          <FirstRun />
        ) : (
          tabs.map((tab) => (
            <Activity
              key={tab.id}
              mode={active === tab.id ? 'visible' : 'hidden'}
            >
              {tab.members.map((member) => (
                <Activity
                  key={member}
                  mode={tab.view === member ? 'visible' : 'hidden'}
                >
                  <div className="flex min-h-0 flex-1 flex-col">
                    <RepositoryView
                      repo={member}
                      settings={settings}
                      version={version}
                    />
                  </div>
                </Activity>
              ))}
            </Activity>
          ))
        )}
      </div>
      <SettingsSurface settings={settings} />
      <span className="sr-only" aria-live="polite">
        {multiple ? `Switched to worktree ${folderName(view)}` : ''}
      </span>
      <CommandPalette repo={view} />
      <Toaster />
    </main>
  );
}
