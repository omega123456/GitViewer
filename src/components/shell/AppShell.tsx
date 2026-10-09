import { Activity, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UpdateBanner } from '../states/UpdateBanner';
import type { SettingsResponse } from '../../lib/types';
import { reportAppError } from '../../lib/ipc';
import { folderName } from '../../lib/paths';
import { useCompact } from '../../stores/density';
import { useActiveView, useTabs } from '../../stores/tabs';
import { useDark } from '../../stores/theme';
import { SettingsSurface } from '../settings/SettingsSurface';
import { FirstRun } from '../states/FirstRun';
import { CommandPalette } from './CommandPalette';
import { RepoTabStrip } from './RepoTabStrip';
import { RepositoryView } from './RepositoryView';
import { Toaster } from './Toaster';
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
  return (
    <main
      data-theme={dark ? 'dark' : 'light'}
      data-density={compact ? 'compact' : 'comfortable'}
      className="relative flex h-screen flex-col overflow-hidden bg-surface font-sans text-ink dark:bg-surface-dark dark:text-ink-dark"
    >
      <RepoTabStrip />
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
      <SettingsSurface settings={settings} />
      <span className="sr-only" aria-live="polite">
        {multiple ? `Switched to worktree ${folderName(view)}` : ''}
      </span>
      <CommandPalette repo={view} />
      <Toaster />
    </main>
  );
}
