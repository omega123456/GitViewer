import { FolderGit2, Plus, Settings as SettingsIcon, X } from 'lucide-react';
import { closeRepository, openRepository } from '../../lib/repository';
import { useBackend } from '../../lib/query';
import { usePalette } from '../../stores/palette';
import { useTabs, type Tab } from '../../stores/tabs';
import { Button } from '../shared/Button';
const strip =
  'w-control self-stretch text-muted hover:bg-track dark:hover:bg-track-dark';
export function RepoTabStrip() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  return (
    <div className="flex h-tab shrink-0 items-stretch border-b border-line bg-chrome dark:border-line-dark dark:bg-chrome-dark">
      {tabs.map((tab) => (
        <RepoTab key={tab.id} tab={tab} active={active === tab.id} />
      ))}
      <Button
        variant="chrome"
        title="Open repository"
        className={strip}
        onClick={() => void openRepository()}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        variant="chrome"
        title="Settings"
        className={`ml-auto ${strip}`}
        onClick={() => usePalette.getState().setSettings(true)}
      >
        <SettingsIcon className="size-4" />
      </Button>
    </div>
  );
}
function RepoTab({ tab, active }: { tab: Tab; active: boolean }) {
  const status = useBackend('status', { repo: tab.id });
  const dirty = Boolean(status.data?.entries.length);
  return (
    <div
      className={`group relative flex min-w-0 max-w-52 items-center border-r border-line pr-1 dark:border-line-dark ${active ? 'bg-surface text-ink dark:bg-surface-dark dark:text-ink-dark' : 'text-muted hover:bg-track hover:text-ink dark:hover:bg-track-dark dark:hover:text-ink-dark'}`}
    >
      {active && (
        <span className="absolute inset-x-0 top-0 h-accent bg-accent dark:bg-accent-dark" />
      )}
      <Button
        variant="chrome"
        className="min-w-0 flex-1 justify-start gap-2 self-stretch pl-2.5"
        onClick={() => useTabs.getState().activate(tab.id)}
      >
        <FolderGit2
          className={`size-4 shrink-0 ${active ? 'text-muted group-hover:text-ink dark:text-muted-dark dark:group-hover:text-ink-dark' : 'text-faint group-hover:text-muted dark:text-faint-dark dark:group-hover:text-muted-dark'}`}
        />
        <span className="truncate">{tab.name}</span>
      </Button>
      <span className="relative grid size-control shrink-0 place-items-center">
        {dirty && (
          <span
            role="img"
            aria-label="Uncommitted changes"
            className={`size-2 rounded-full bg-modified dark:bg-modified-dark ${active ? 'hidden' : 'group-hover:opacity-0 group-focus-within:opacity-0'}`}
          />
        )}
        <Button
          variant="chrome"
          aria-label={`Close ${tab.name}`}
          className={`absolute inset-0 ${active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
          onClick={() => void closeRepository(tab)}
        >
          <X className="size-4" />
        </Button>
      </span>
    </div>
  );
}
