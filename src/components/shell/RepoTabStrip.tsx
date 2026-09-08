import { FolderGit2, Plus, Settings as SettingsIcon, X } from 'lucide-react';
import { closeRepository, openRepository } from '../../lib/repository';
import { useBackend } from '../../lib/query';
import { usePalette } from '../../stores/palette';
import { useTabs, type Tab } from '../../stores/tabs';
import { Button } from '../shared/Button';
export function RepoTabStrip() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  return (
    <div className="flex h-tab shrink-0 items-stretch border-b border-line bg-chrome dark:border-line-dark dark:bg-chrome-dark">
      {tabs.map((tab) => (
        <RepoTab key={tab.id} tab={tab} active={active === tab.id} />
      ))}
      <Button
        title="Open repository"
        className="text-muted"
        onClick={() => void openRepository()}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        title="Settings"
        className="ml-auto text-muted"
        onClick={() => usePalette.getState().setSettings(true)}
      >
        <SettingsIcon className="size-4" />
      </Button>
    </div>
  );
}
function RepoTab({ tab, active }: { tab: Tab; active: boolean }) {
  const status = useBackend('status', { repo: tab.id });
  return (
    <div
      className={`relative flex min-w-0 max-w-52 items-center border-r border-line pl-3 text-muted dark:border-line-dark ${active ? 'bg-surface text-ink dark:bg-surface-dark dark:text-ink-dark' : ''}`}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
      <FolderGit2 className="size-3.5 shrink-0" />
      <Button
        className="min-w-0 truncate"
        onClick={() => useTabs.getState().activate(tab.id)}
      >
        <span className="truncate">{tab.name}</span>
        {Boolean(status.data?.entries.length) && (
          <span className="text-modified" aria-label="Uncommitted changes">
            ●
          </span>
        )}
      </Button>
      <Button
        className="pl-0 opacity-45"
        aria-label={`Close ${tab.name}`}
        onClick={() => void closeRepository(tab)}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
