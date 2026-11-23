import {
  FolderGit2,
  GitBranch,
  Plus,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import { useEffect, type KeyboardEvent } from 'react';
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
import { dirtyDot, errorDot, tabBar } from '../shared/styles';
import { focusTab } from '../shared/ViewSwitch';
import { handleKeyByTable, tabKeyHandlers } from '../../lib/keyboard';
const strip =
  'size-8 rounded text-muted hover:bg-tab-hover hover:text-ink dark:text-muted-dark dark:hover:bg-tab-hover-dark dark:hover:text-ink-dark';
export function RepoTabStrip() {
  const tabs = useTabs((state) => state.tabs);
  const active = useTabs((state) => state.active);
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    const current = Math.max(
      tabs.findIndex((tab) => tab.id === active),
      0,
    );
    handleKeyByTable(
      event,
      tabKeyHandlers(current, tabs.length, (index) => {
        useTabs.getState().activate(tabs[index].id);
        focusTab(list, index);
      }),
    );
  };
  return (
    <div
      className={`flex h-tab-strip shrink-0 items-end gap-0.5 pr-2 ${mica() ? 'bg-transparent' : 'bg-chrome dark:bg-chrome-dark'}`}
    >
      <div
        role="tablist"
        aria-label="Open repositories"
        tabIndex={-1}
        onKeyDown={keydown}
        className="flex h-full min-w-0 items-end gap-0.5"
      >
        {tabs.map((tab) => (
          <RepoTab key={tab.id} tab={tab} active={active === tab.id} />
        ))}
      </div>
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
        className={`ml-auto ${strip}`}
        onClick={() => usePalette.getState().setSettings(true)}
      >
        <SettingsIcon className="size-4" />
      </Button>
    </div>
  );
}
function useTabSignals(tab: Tab) {
  const statuses = useStatuses(tab.members);
  const dirty = tab.members.some((member) => statuses[member]?.entries.length);
  const failed = useErrors((state) =>
    tab.members.some((member) => state.scopes[member]?.length),
  );
  const working = useActivity((state) =>
    tab.members.some((member) =>
      (state.scopes[member] ?? []).some((entry) => entry.visible),
    ),
  );
  return {
    dirty: dirty,
    failed: failed,
    working: working,
    branch: statuses[tab.view]?.branch,
  };
}
const failedDot = `shrink-0 ${errorDot}`;
export function RepositorySignals({
  tab,
  current,
}: {
  tab: Tab;
  current: boolean;
}) {
  const { dirty, failed, working, branch } = useTabSignals(tab);
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2.5 text-meta text-muted dark:text-muted-dark">
      {branch && (
        <span className="flex max-w-40 items-center gap-1 font-mono">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      )}
      {working && !current && (
        <span role="img" aria-label="Git operation running">
          <Spinner className="size-3 text-accent dark:text-accent-dark" />
        </span>
      )}
      {failed && !current && !working && (
        <span role="img" aria-label="Errors waiting" className={failedDot} />
      )}
      {dirty && (
        <span
          role="img"
          aria-label="Uncommitted changes"
          className={dirtyDot}
        />
      )}
      {current && (
        <span className="text-faint dark:text-faint-dark">Current</span>
      )}
    </span>
  );
}
const activeTabClass = `z-10 border-tab-stroke bg-sub font-semibold text-ink dark:border-tab-stroke-dark dark:bg-sub-dark dark:text-ink-dark ${tabBar}`;
const idleTabClass =
  'border-transparent text-muted hover:bg-tab-hover hover:text-ink dark:text-muted-dark dark:hover:bg-tab-hover-dark dark:hover:text-ink-dark';
function useMemberSync(tab: Tab, active: boolean) {
  const anchor = anchorOf(tab);
  const worktrees = useBackend(
    'worktrees',
    { repo: anchor },
    Boolean(anchor) && active,
  );
  useEffect(() => {
    if (worktrees.data) void syncMembers(tab.id, worktrees.data);
  }, [tab.id, worktrees.data]);
}
function tabTitle(tab: Tab, branch?: string) {
  if (tab.members.length <= 1) return undefined;
  return `${tab.name} · worktree ${folderName(tab.view)} on ${branch}`;
}
interface TabSignals {
  working: boolean;
  failed: boolean;
}
function TabSignalIcons({ signals }: { signals: TabSignals }) {
  if (signals.working)
    return (
      <span role="img" aria-label="Git operation running">
        <Spinner className="size-3 text-accent dark:text-accent-dark" />
      </span>
    );
  if (signals.failed)
    return (
      <span role="img" aria-label="Errors waiting" className={failedDot} />
    );
  return null;
}
function TabClose({
  tab,
  active,
  dirty,
}: {
  tab: Tab;
  active: boolean;
  dirty: boolean;
}) {
  return (
    <span className="relative grid size-control shrink-0 place-items-center">
      {dirty && (
        <span
          role="img"
          aria-label="Uncommitted changes"
          className={`${dirtyDot} ${active ? 'hidden' : 'group-hover:opacity-0 group-focus-within:opacity-0'}`}
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
  );
}
function RepoTab({ tab, active }: { tab: Tab; active: boolean }) {
  const signals = useTabSignals(tab);
  useMemberSync(tab, active);
  const working = signals.working && !active;
  const failed = signals.failed && !active;
  return (
    <div
      className={`group relative flex h-tab w-44 min-w-0 shrink items-center rounded-t border-x border-t pr-1 first:rounded-tl-none first:border-l-transparent ${active ? activeTabClass : idleTabClass}`}
    >
      <Button
        variant="chrome"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className="min-w-0 flex-1 justify-start gap-2 self-stretch rounded-tl pl-2.75"
        title={tabTitle(tab, signals.branch)}
        onClick={() => useTabs.getState().activate(tab.id)}
      >
        <FolderGit2 className="size-3.75 shrink-0" />
        <span className="truncate">{tab.name}</span>
        <TabSignalIcons signals={{ working: working, failed: failed }} />
      </Button>
      <TabClose tab={tab} active={active} dirty={signals.dirty} />
    </div>
  );
}
