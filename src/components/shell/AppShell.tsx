import type { Settings } from '../../lib/types';
import { useCompact } from '../../stores/density';
import { useTabs } from '../../stores/tabs';
import { useDark } from '../../stores/theme';
import { SettingsSurface } from '../settings/SettingsSurface';
import { FirstRun } from '../states/FirstRun';
import { CommandPalette } from './CommandPalette';
import { ErrorBanner } from './ErrorBanner';
import { RepoTabStrip } from './RepoTabStrip';
import { RepositoryView } from './RepositoryView';
export function AppShell({
  settings,
  version,
}: {
  settings: Settings;
  version: string;
}) {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const dark = useDark();
  const compact = useCompact();
  return (
    <main
      data-theme={dark ? 'dark' : 'light'}
      data-density={compact ? 'compact' : 'comfortable'}
      className="flex h-screen flex-col overflow-hidden bg-surface font-sans text-ink dark:bg-surface-dark dark:text-ink-dark"
    >
      <RepoTabStrip />
      <ErrorBanner />
      {tabs.length === 0 ? (
        <FirstRun />
      ) : (
        tabs.map((tab) => (
          <div
            key={tab.id}
            className={
              active === tab.id ? 'flex min-h-0 flex-1 flex-col' : 'hidden'
            }
          >
            <RepositoryView
              repo={tab.id}
              settings={settings}
              version={version}
            />
          </div>
        ))
      )}
      <SettingsSurface settings={settings} />
      <CommandPalette repo={active} />
    </main>
  );
}
