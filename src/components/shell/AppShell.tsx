import { Activity, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UpdateBanner } from '../states/UpdateBanner';
import type { SettingsResponse } from '../../lib/types';
import { fetchIntervals } from '../../lib/intervals';
import { reportAppError } from '../../lib/ipc';
import { scheduleAutoFetch } from '../../lib/fetch-schedule';
import { folderName } from '../../lib/paths';
import { mica } from '../../lib/platform';
import { useActiveTab, useActiveView, useTabs } from '../../stores/tabs';
import { useCompact, useDark } from '../../lib/theme';
import { SettingsSurface } from '../settings/SettingsSurface';
import { FirstRun } from '../states/FirstRun';
import { CommandPalette } from './CommandPalette';
import { RepoTabStrip } from './RepoTabStrip';
import { RepositoryView } from './RepositoryView';
import { Toaster } from './Toaster';
interface ShellProps {
  settings: SettingsResponse;
  version: string;
}
function useWindowTitle(project?: string) {
  useEffect(() => {
    getCurrentWindow()
      .setTitle(project ? `${project} — GitViewer` : 'GitViewer')
      .catch(reportAppError);
  }, [project]);
}
function visibility(shown: boolean) {
  return shown ? 'visible' : 'hidden';
}
function TabViews({ settings, version }: ShellProps) {
  const tabs = useTabs((state) => state.tabs);
  const active = useTabs((state) => state.active);
  if (tabs.length === 0) return <FirstRun />;
  return tabs.map((tab) => (
    <Activity key={tab.id} mode={visibility(active === tab.id)}>
      {tab.members.map((member) => (
        <Activity key={member} mode={visibility(tab.view === member)}>
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
  ));
}
function WorktreeAnnouncement() {
  const view = useActiveView();
  const shownTab = useActiveTab();
  const multiple = (shownTab?.members.length ?? 0) > 1;
  return (
    <span className="sr-only" aria-live="polite">
      {multiple ? `Switched to worktree ${folderName(view)}` : ''}
    </span>
  );
}
export function AppShell({ settings, version }: ShellProps) {
  const view = useActiveView();
  const shownTab = useActiveTab();
  const dark = useDark();
  const compact = useCompact();
  useWindowTitle(shownTab?.name);
  const every = fetchIntervals[settings.autoFetchInterval].every;
  useEffect(() => scheduleAutoFetch(every), [every]);
  return (
    <main
      data-theme={dark ? 'dark' : 'light'}
      data-density={compact ? 'compact' : 'comfortable'}
      className={`relative flex h-screen flex-col overflow-hidden font-sans text-ink dark:text-ink-dark ${mica() ? 'bg-transparent' : 'bg-surface dark:bg-surface-dark'}`}
    >
      <RepoTabStrip />
      <div className="flex min-h-0 flex-1 flex-col bg-surface dark:bg-surface-dark">
        <UpdateBanner />
        <TabViews settings={settings} version={version} />
      </div>
      <SettingsSurface settings={settings} />
      <WorktreeAnnouncement />
      <CommandPalette repo={view} />
      <Toaster />
    </main>
  );
}
