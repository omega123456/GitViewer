import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  GitCommitHorizontal,
  GitCompare,
  GitMerge,
  History,
  ListChecks,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Trash2,
  RotateCw,
  Sparkles,
  SquareMinus,
  SquarePlus,
  Upload,
} from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useActions } from '../../lib/actions';
import { perform, useBackend } from '../../lib/query';
import type { Action } from '../../lib/keyboard';
import type { SettingsResponse } from '../../lib/types';
import { useBusy } from '../../stores/activity';
import { useCommit } from '../../stores/commit';
import { useGenerate, useGenerateState } from '../../stores/generate';
import { type CommitMode, useMessage, useTabs } from '../../stores/tabs';
import { useLayout, useTabLayout } from '../../stores/layout';
import {
  useAllChanges,
  useCurrentSelection,
  useSelection,
} from '../../stores/selection';
import { useFilter } from '../../stores/filter';
import { Button } from '../shared/Button';
import { dynamic } from '../shared/styles';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { AllChangesPane } from '../diff/AllChangesPane';
import { DiffPane } from '../diff/DiffPane';
import { CommitList } from '../history/CommitList';
import { ChangesSection } from '../sidebar/ChangesSection';
import {
  baseFieldId,
  CompareSection,
  openCompare,
} from '../sidebar/CompareSection';
import { aiConfigured, CommitFooter } from '../sidebar/CommitFooter';
import { FilesSection } from '../sidebar/FilesSection';
import { SidebarModeToggle } from '../sidebar/SidebarModeToggle';
import { StashSection } from '../stash/StashSection';
import { ResizeHandle } from './ResizeHandle';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
export function RepositoryView({
  repo,
  settings,
  version,
}: {
  repo: string;
  settings: SettingsResponse;
  version: string;
}) {
  const query = useBackend('status', { repo });
  const busy = useBusy(repo);
  const generate = useGenerateState(repo);
  const message = useMessage(repo);
  const filter = useFilter(repo);
  const layout = useTabLayout(repo);
  const select = useCurrentSelection(repo, layout.mode);
  const all = useAllChanges(repo);
  const status = query.data;
  const disabled = busy || !status || status.conflicted;
  const conflicts = (status?.entries ?? []).filter(
    (entry) => entry.kind === 'unmerged',
  ).length;
  const selectedEntry = status?.entries.find(
    (entry) => entry.path === select?.path,
  );
  const sidebarWidth =
    layout.mode === 'working' ? layout.width : layout.historyWidth;
  const moveFile = (direction: number) => {
    const files =
      status?.entries
        .flatMap((entry) => [
          ...(entry.index !== '.' && entry.index !== '?'
            ? [{ path: entry.path, source: 'staged' as const }]
            : []),
          ...(entry.worktree !== '.'
            ? [
                {
                  path: entry.path,
                  source:
                    entry.index === '?'
                      ? ('file' as const)
                      : ('unstaged' as const),
                },
              ]
            : []),
        ])
        .filter((entry) =>
          entry.path.toLowerCase().includes(filter.toLowerCase()),
        ) ?? [];
    if (!files.length) return;
    const current = files.findIndex(
      (entry) => entry.path === select?.path && entry.source === select.source,
    );
    useLayout.getState().update(repo, { mode: 'working' });
    useSelection
      .getState()
      .select(repo, files[(current + direction + files.length) % files.length]);
  };
  const discard = async () => {
    if (
      select &&
      (await confirm(
        `Discard changes to ${select.path}? These changes cannot be recovered by Git.`,
        { title: 'Discard file', kind: 'warning' },
      ))
    )
      await perform('files_action', {
        repo,
        paths: [select.path],
        action: 'discard',
      });
  };
  const staged = Boolean(
    status?.entries.some((entry) => entry.index !== '.' && entry.index !== '?'),
  );
  const changes = status?.entries.map((entry) => entry.path) ?? [];
  const committable =
    Boolean(message.trim()) &&
    (staged || (changes.length > 0 && settings.smartCommit !== 'never'));
  const commit = (mode: CommitMode) => {
    const store = useCommit.getState();
    if (staged) return store.run(repo, { message, mode, stage: [] });
    if (settings.smartCommit === 'always')
      return store.run(repo, { message, mode, stage: changes });
    store.ask(repo, mode);
  };
  const actions: Action[] = [
    {
      id: 'refresh',
      icon: <RotateCw className="size-3.5" />,
      label: 'Refresh repository',
      key: 'Mod+r',
      run: () => perform('refresh', { repo }),
    },
    {
      id: 'stage',
      icon: <SquarePlus className="size-3.5" />,
      label: 'Stage selected file',
      key: 's',
      disabled:
        disabled ||
        layout.mode !== 'working' ||
        !selectedEntry ||
        selectedEntry.worktree === '.',
      run: () =>
        perform('files_action', {
          repo,
          paths: [select!.path],
          action: 'stage',
        }),
    },
    {
      id: 'unstage',
      icon: <SquareMinus className="size-3.5" />,
      label: 'Unstage selected file',
      key: 'u',
      disabled:
        disabled ||
        layout.mode !== 'working' ||
        !selectedEntry ||
        ['.', '?'].includes(selectedEntry.index),
      run: () =>
        perform('files_action', {
          repo,
          paths: [select!.path],
          action: 'unstage',
        }),
    },
    {
      id: 'discard-file',
      icon: <Trash2 className="size-3.5" />,
      label: 'Discard selected file',
      key: 'Mod+Shift+d',
      disabled:
        disabled ||
        layout.mode !== 'working' ||
        !selectedEntry ||
        ['.', '?'].includes(selectedEntry.worktree),
      run: discard,
    },
    {
      id: 'next-file',
      icon: <ChevronRight className="size-3.5" />,
      label: 'Next changed file',
      key: 'Alt+ArrowRight',
      disabled: !status?.entries.length,
      run: () => moveFile(1),
    },
    {
      id: 'previous-file',
      icon: <ChevronLeft className="size-3.5" />,
      label: 'Previous changed file',
      key: 'Alt+ArrowLeft',
      disabled: !status?.entries.length,
      run: () => moveFile(-1),
    },
    {
      id: 'all',
      icon: <ListChecks className="size-3.5" />,
      label: 'Stage all changes',
      key: 'Mod+Shift+a',
      disabled,
      run: () =>
        perform('files_action', {
          repo,
          paths: status!.entries.map((entry) => entry.path),
          action: 'stage',
        }),
    },
    {
      id: 'commit',
      icon: <GitCommitHorizontal className="size-3.5" />,
      label: 'Commit changes',
      key: 'Mod+Enter',
      disabled: disabled || !committable,
      run: () => commit('commit'),
    },
    {
      id: 'commit-push',
      icon: <Upload className="size-3.5" />,
      label: 'Commit and push changes',
      key: 'Mod+Shift+Enter',
      disabled: disabled || !committable || status?.branch === '(detached)',
      run: () => commit('commitPush'),
    },
    {
      id: 'generate-message',
      icon: <Sparkles className="size-3.5" />,
      label: 'Generate commit message',
      key: 'Mod+Alt+g',
      disabled: !aiConfigured(settings) || generate.busy,
      run: () => useGenerate.getState().generate(repo),
    },
    {
      id: 'fetch',
      icon: <RefreshCw className="size-3.5" />,
      label: 'Fetch',
      key: 'Mod+Shift+f',
      disabled,
      run: () => perform('sync', { repo, action: 'fetch' }),
    },
    {
      id: 'pull',
      icon: <Download className="size-3.5" />,
      label: 'Pull',
      key: 'Mod+Shift+l',
      disabled: disabled || status?.branch === '(detached)',
      run: () => perform('sync', { repo, action: 'pull' }),
    },
    {
      id: 'push',
      icon: <Upload className="size-3.5" />,
      label: 'Push',
      key: 'Mod+Shift+u',
      disabled: disabled || status?.branch === '(detached)',
      run: () => perform('sync', { repo, action: 'push' }),
    },
    {
      id: 'history',
      icon: <History className="size-3.5" />,
      label: 'Toggle history',
      key: 'Mod+h',
      run: () =>
        useLayout.getState().update(repo, {
          mode: layout.mode === 'history' ? 'working' : 'history',
        }),
    },
    {
      id: 'compare',
      icon: <GitCompare className="size-3.5" />,
      label: 'Compare branches',
      key: 'Mod+Shift+c',
      run: () => {
        openCompare(repo);
        requestAnimationFrame(() =>
          document.getElementById(baseFieldId(repo))?.focus(),
        );
      },
    },
    {
      id: 'stash',
      icon: <Archive className="size-3.5" />,
      label: 'Stash changes',
      key: 'Mod+Shift+s',
      disabled,
      run: () =>
        perform('stash_save', { repo, message: 'Saved from GitViewer' }),
    },
    {
      id: 'next-tab',
      icon: <PanelRight className="size-3.5" />,
      label: 'Next repository',
      key: 'Mod+Alt+ArrowRight',
      run: () => moveTab(1),
    },
    {
      id: 'previous-tab',
      icon: <PanelLeft className="size-3.5" />,
      label: 'Previous repository',
      key: 'Mod+Alt+ArrowLeft',
      run: () => moveTab(-1),
    },
  ];
  useActions(`${repo}:repository`, actions);
  if (query.error)
    return (
      <ErrorState
        title="Could not read the repository"
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  if (!status) return <State title="Loading repository…" />;
  return (
    <>
      <Toolbar
        repo={repo}
        status={status}
        disabled={disabled}
        actions={actions}
      />
      {status.conflicted && (
        <div
          role="alert"
          className={`flex items-center gap-2 px-3 py-2 text-xs ${status.merging ? 'bg-merge text-merge-ink dark:bg-merge-dark dark:text-merge-ink-dark' : 'bg-remove text-remove-ink dark:bg-remove-dark dark:text-remove-ink-dark'}`}
        >
          {status.merging ? (
            <>
              <GitMerge className="size-3.5 shrink-0" />
              <span>
                Merging {status.merging} into {status.branch}. {conflicts}{' '}
                {conflicts === 1 ? 'path conflicts' : 'paths conflict'} —
                resolve them in your editor, then finish the merge from a
                terminal.
              </span>
              <Button
                className="ml-auto border border-current"
                disabled={busy}
                onClick={() => void perform('merge_abort', { repo })}
              >
                Abort merge
              </Button>
            </>
          ) : (
            <span>
              {conflicts} paths have conflicts. Resolve them in a terminal. This
              repository is read-only.
            </span>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-sidebar shrink-0 flex-col bg-sub dark:bg-sub-dark"
          style={dynamic({ '--sidebar-width': `${sidebarWidth}px` })}
        >
          <SidebarModeToggle repo={repo} />
          <div
            className={
              layout.mode === 'working'
                ? 'flex min-h-0 flex-1 flex-col overflow-y-auto'
                : 'hidden'
            }
          >
            <ChangesSection repo={repo} status={status} disabled={disabled} />
            <FilesSection repo={repo} status={status} />
            <StashSection repo={repo} disabled={disabled} />
          </div>
          <div
            className={
              layout.mode === 'history'
                ? 'flex min-h-0 flex-1 flex-col'
                : 'hidden'
            }
          >
            <CommitList repo={repo} />
          </div>
          {layout.mode === 'compare' && (
            <CompareSection repo={repo} status={status} />
          )}
          {layout.mode === 'working' && (
            <CommitFooter
              repo={repo}
              status={status}
              settings={settings}
              disabled={disabled || !committable}
              pushable={status.branch !== '(detached)'}
              commit={(mode) => void commit(mode)}
            />
          )}
        </aside>
        <ResizeHandle
          label="Resize sidebar"
          orientation="horizontal"
          min={240}
          max={650}
          step={10}
          value={sidebarWidth}
          className="w-1 shrink-0 cursor-col-resize bg-line hover:bg-accent focus-visible:bg-accent dark:bg-line-dark"
          measure={(event) => event.clientX}
          onChange={(width) =>
            useLayout
              .getState()
              .update(
                repo,
                layout.mode === 'working' ? { width } : { historyWidth: width },
              )
          }
        />
        <div className="min-w-0 flex-1">
          {all &&
          (all === 'commit'
            ? layout.mode !== 'compare' && select?.revision
            : all === 'compare'
              ? layout.mode === 'compare'
              : layout.mode === 'working') ? (
            <AllChangesPane
              repo={repo}
              stack={all}
              commit={select}
              status={status}
              settings={settings}
              disabled={disabled}
            />
          ) : (
            <DiffPane
              repo={repo}
              selection={select?.path ? select : undefined}
              settings={settings}
              disabled={disabled}
            />
          )}
        </div>
      </div>
      <StatusBar repo={repo} status={status} version={version} />
    </>
  );
}
function moveTab(direction: number) {
  const state = useTabs.getState();
  const index = state.tabs.findIndex((tab) => tab.id === state.active);
  state.activate(
    state.tabs[(index + direction + state.tabs.length) % state.tabs.length].id,
  );
}
