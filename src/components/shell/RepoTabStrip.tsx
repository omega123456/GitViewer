import { FolderGit2, Plus, Settings as SettingsIcon, X } from 'lucide-react';
import { useEffect } from 'react';
import { folderName } from '../../lib/paths';
import { mica } from '../../lib/platform';
import {
  closeRepository,
  openRepository,
  syncMembers,
} from '../../lib/repository';
import { useBackend, useStatuses } from '../../lib/query';
import { useActivity } from '../../stores/activity';
import { useErrors } from '../../stores/errors';
import { usePalette } from '../../stores/palette';
import { anchorOf, useTabs, type Tab } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
const strip =
  'size-8 rounded text-muted hover:bg-tab-hover hover:text-ink dark:text-muted-dark dark:hover:bg-tab-hover-dark dark:hover:text-ink-dark';
export function RepoTabStrip() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  return (
    <div
      className={`flex h-tab-strip shrink-0 items-end gap-0.5 pr-2 ${mica() ? 'bg-transparent' : 'bg-chrome dark:bg-chrome-dark'}`}
    >
      {tabs.map((tab) => (
        <RepoTab key={tab.id} tab={tab} active={active === tab.id} />
      ))}
      <Button
        variant="chrome"
        title="Open repository"
        className={`ml-1 ${strip}`}
        onClick={() => void openRepository()}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        variant="chrome"
        title="Settings"
        className={`ml-auto self-center ${strip}`}
        onClick={() => usePalette.getState().setSettings(true)}
      >
        <SettingsIcon className="size-4" />
      </Button>
    </div>
  );
}
function RepoTab({ tab, active }: { tab: Tab; active: boolean }) {
  const statuses = useStatuses(tab.members);
  const anchor = anchorOf(tab);
  const worktrees = useBackend(
    'worktrees',
    { repo: anchor },
    Boolean(anchor) && active,
  );
  useEffect(() => {
    if (worktrees.data) void syncMembers(tab.id, worktrees.data);
  }, [tab.id, worktrees.data]);
  const dirty = tab.members.some((member) => statuses[member]?.entries.length);
  const failed = useErrors((s) =>
    tab.members.some((member) => s.scopes[member]?.length),
  );
  const working =
    useActivity((s) =>
      tab.members.some((member) =>
        (s.scopes[member] ?? []).some((entry) => entry.visible),
      ),
    ) && !active;
  const branch = statuses[tab.view]?.branch;
  return (
    <div
      className={`group relative flex h-tab w-44 min-w-0 shrink items-center rounded-t border-x border-t pr-1 first:rounded-tl-none first:border-l-transparent ${active ? 'z-10 border-tab-stroke bg-sub font-semibold text-ink dark:border-tab-stroke-dark dark:bg-sub-dark dark:text-ink-dark' : 'border-transparent text-muted hover:bg-tab-hover hover:text-ink dark:text-muted-dark dark:hover:bg-tab-hover-dark dark:hover:text-ink-dark'}`}
    >
      <Button
        variant="chrome"
        className="min-w-0 flex-1 justify-start gap-2 self-stretch rounded-tl pl-2.75"
        title={
          tab.members.length > 1
            ? `${tab.name} · worktree ${folderName(tab.view)} on ${branch}`
            : undefined
        }
        onClick={() => useTabs.getState().activate(tab.id)}
      >
        <FolderGit2 className="size-3.75 shrink-0" />
        <span className="truncate">{tab.name}</span>
        {working && (
          <span role="img" aria-label="Git operation running">
            <Spinner className="size-3 text-accent dark:text-accent-dark" />
          </span>
        )}
        {failed && !active && !working && (
          <span
            role="img"
            aria-label="Errors waiting"
            className="size-1.5 shrink-0 rounded-full bg-error-ink dark:bg-error-ink-dark"
          />
        )}
      </Button>
      <span className="relative grid size-control shrink-0 place-items-center">
        {dirty && (
          <span
            role="img"
            aria-label="Uncommitted changes"
            className={`size-1.5 rounded-full bg-modified dark:bg-modified-dark ${active ? 'hidden' : 'group-hover:opacity-0 group-focus-within:opacity-0'}`}
          />
        )}
        <Button
          variant="chrome"
          aria-label={`Close ${tab.name}`}
          className={`absolute inset-0 rounded hover:bg-hover dark:hover:bg-hover-dark ${active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
          onClick={() => void closeRepository(tab)}
        >
          <X className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}
