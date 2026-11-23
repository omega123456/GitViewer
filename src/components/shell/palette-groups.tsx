import type { ReactNode } from 'react';
import { FolderGit2 } from 'lucide-react';
import { shortcutLabel, type Action } from '../../lib/keyboard';
import { fuzzyFilter, fuzzySearch, type FuzzyMatch } from '../../lib/fuzzy';
import { fileName, parentPath } from '../../lib/paths';
import { isScopeOf, scopeName, UNMODIFIED } from '../../lib/git';
import type { Entry, Status } from '../../lib/types';
import { useLayout } from '../../stores/layout';
import type { PaletteMode } from '../../stores/palette';
import { useSelection } from '../../stores/selection';
import { useTabs, type Tab } from '../../stores/tabs';
import { FileIcon } from '../sidebar/FileIcon';
import { sourceFor } from '../sidebar/nodes';
import { StatusBadge } from '../sidebar/StatusBadge';
import { MatchedText } from '../shared/MatchedText';
import { RepositorySignals } from './RepoTabStrip';
const groupNames: Record<string, string> = {
  app: 'Application',
  repository: 'Repository',
  branches: 'Branches',
  worktrees: 'Worktrees',
  diff: 'Diff',
  stashes: 'Stashes',
  image: 'Image',
};
const groupOrder = Object.keys(groupNames);
export interface Row {
  id: string;
  icon: ReactNode;
  label: ReactNode;
  title: string;
  trailing: ReactNode;
  disabled?: boolean;
  run: () => void;
}
export interface Group {
  name: string;
  rows: Row[];
}
export interface PaletteSources {
  repo: string;
  filter: string;
  scopes: Record<string, Action[]>;
  tabs: Tab[];
  active: string;
  statuses: Record<string, Status | undefined>;
  matches: FuzzyMatch<string>[];
  entries: Map<string, Entry>;
}
export interface HintSources {
  ignored: boolean;
  openKey: string | undefined;
  fileKey: string | undefined;
}
export function Keys({ shortcut }: { shortcut: string }) {
  const keys = shortcutLabel(shortcut)
    .split('+')
    .filter(Boolean)
    .map((key) => (key.length === 1 ? key.toUpperCase() : key));
  return (
    <span aria-hidden className="ml-auto flex shrink-0 gap-1">
      {keys.map((key, index) => (
        <kbd
          key={index}
          className="flex h-6 min-w-6 items-center justify-center rounded border border-b-2 border-line bg-sub px-1.5 font-mono text-meta text-muted dark:border-line-dark dark:bg-sub-dark dark:text-muted-dark"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
function FileLabel({
  path,
  positions,
}: {
  path: string;
  positions: ReadonlySet<number>;
}) {
  const slash = path.lastIndexOf('/');
  const nameStart = slash + 1;
  return (
    <span className="flex min-w-0 items-baseline gap-2.5">
      <span className="max-w-full shrink-0 truncate font-medium">
        <MatchedText
          text={path.slice(nameStart)}
          start={nameStart}
          positions={positions}
        />
      </span>
      {slash > 0 && (
        <span className="truncate text-meta text-muted dark:text-muted-dark">
          <MatchedText text={path.slice(0, slash)} positions={positions} />
        </span>
      )}
    </span>
  );
}
function RepositoryLabel({ name, path }: { name: string; path: string }) {
  const parent = parentPath(path);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
      <span className="max-w-full shrink-0 truncate font-medium">{name}</span>
      {parent && (
        <span
          dir="rtl"
          className="truncate text-meta text-muted dark:text-muted-dark"
        >
          <bdi dir="ltr">{parent}</bdi>
        </span>
      )}
    </span>
  );
}
function entryStatus(entry: Entry | undefined) {
  if (!entry) return '';
  if (entry.worktree !== UNMODIFIED) return entry.worktree;
  return entry.index;
}
function repositoryRow(tab: Tab, active: string): Row {
  return {
    id: tab.id,
    icon: <FolderGit2 className="size-3.5" />,
    label: <RepositoryLabel name={tab.name} path={tab.id} />,
    title: tab.id,
    trailing: <RepositorySignals tab={tab} current={tab.id === active} />,
    run: () => useTabs.getState().activate(tab.id),
  };
}
function repositoryGroups(sources: PaletteSources): Group[] {
  const { filter, tabs, statuses, active } = sources;
  const searchText = (tab: Tab) =>
    [tab.name, statuses[tab.view]?.branch, tab.id].join(' ');
  return [
    {
      name: 'Open repositories',
      rows: fuzzyFilter(filter, tabs, searchText).map((tab) =>
        repositoryRow(tab, active),
      ),
    },
  ];
}
function openFile(repo: string, path: string, entry: Entry | undefined) {
  useLayout.getState().update(repo, { mode: 'working' });
  useSelection
    .getState()
    .select(repo, { path: path, source: sourceFor(entry) });
}
function fileRow(
  { item: path, positions }: FuzzyMatch<string>,
  sources: PaletteSources,
): Row {
  const entry = sources.entries.get(path);
  return {
    id: path,
    icon: <FileIcon name={fileName(path)} directory={false} size="size-3.5" />,
    label: <FileLabel path={path} positions={positions} />,
    title: path,
    trailing: <StatusBadge status={entryStatus(entry)} />,
    run: () => openFile(sources.repo, path, entry),
  };
}
function fileGroups(sources: PaletteSources): Group[] {
  return [
    {
      name: 'Files',
      rows: sources.matches.map((match) => fileRow(match, sources)),
    },
  ];
}
function actionRow({ item: action, positions }: FuzzyMatch<Action>): Row {
  return {
    id: action.id,
    icon: action.icon,
    label: (
      <span className="truncate">
        <MatchedText text={action.label} positions={positions} />
      </span>
    ),
    title: action.label,
    trailing: <Keys shortcut={action.key} />,
    disabled: action.disabled,
    run: () => void action.run(),
  };
}
function commandGroups({ filter, scopes, repo }: PaletteSources): Group[] {
  const isVisibleScope = (scope: string) =>
    scope === 'app' || isScopeOf(scope, repo);
  return Object.entries(scopes)
    .filter(([scope]) => isVisibleScope(scope))
    .map(([scope, actions]) => [scopeName(scope), actions] as const)
    .sort(
      ([left], [right]) => groupOrder.indexOf(left) - groupOrder.indexOf(right),
    )
    .map(([group, actions]) => ({
      name: groupNames[group] ?? group,
      rows: fuzzySearch(filter, actions, (action) => action.label).map(
        actionRow,
      ),
    }));
}
export const groupBuilders: Record<
  PaletteMode,
  (sources: PaletteSources) => Group[]
> = {
  commands: commandGroups,
  files: fileGroups,
  repositories: repositoryGroups,
};
export const emptyHints: Record<
  PaletteMode,
  (sources: HintSources) => string | null
> = {
  commands: ({ fileKey }) =>
    fileKey ? `Press ${shortcutLabel(fileKey)} to search files instead` : null,
  files: ({ ignored }) =>
    ignored ? null : 'Include ignored files to widen the search',
  repositories: ({ openKey }) =>
    openKey
      ? `Press ${shortcutLabel(openKey)} to open another repository`
      : null,
};
