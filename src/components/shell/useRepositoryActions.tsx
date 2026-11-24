import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  GitCommitHorizontal,
  GitCompare,
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
  X,
} from 'lucide-react';
import { useActions } from '../../lib/actions';
import { routeCommit, type CommitPlan } from '../../lib/commit';
import { isDetached, scopeKey } from '../../lib/git';
import type { Action } from '../../lib/keyboard';
import { useOpenFile } from '../../lib/open-file';
import { pull } from '../../lib/pull';
import { perform } from '../../lib/query';
import { discardFile } from '../../lib/revert';
import type {
  Entry,
  Selection,
  SettingsResponse,
  Status,
} from '../../lib/types';
import {
  changedFiles,
  hasWorktreeChange,
  isDiscardable,
  isStagedEntry,
  steppedFile,
} from '../../lib/working-files';
import { useFilterStore } from '../../stores/filter';
import {
  isGenerating,
  useGenerate,
  useGeneration,
} from '../../stores/generate';
import { useLayout, type SidebarMode } from '../../stores/layout';
import { tabKey, useFileTabs, useSelection } from '../../stores/selection';
import { useTabs, type CommitMode } from '../../stores/tabs';
import { aiConfigured } from '../sidebar/CommitFooter';
import { baseFieldId, openCompare } from '../sidebar/CompareSection';
const NEXT = 1;
const PREVIOUS = -1;
export interface RepositoryActionContext {
  repo: string;
  settings: SettingsResponse;
  status: Status | undefined;
  mode: SidebarMode;
  selection: Selection | undefined;
  disabled: boolean;
  plan: CommitPlan;
  startStash: () => void;
}
function focusCompare(repo: string) {
  openCompare(repo);
  requestAnimationFrame(() =>
    document.getElementById(baseFieldId(repo))?.focus(),
  );
}
interface FileAbilities {
  stage: boolean;
  unstage: boolean;
  discard: boolean;
}
const noAbilities: FileAbilities = {
  stage: false,
  unstage: false,
  discard: false,
};
function abilitiesOf(entry: Entry | undefined): FileAbilities {
  if (!entry) return noAbilities;
  return {
    stage: hasWorktreeChange(entry),
    unstage: isStagedEntry(entry),
    discard: isDiscardable(entry),
  };
}
function toggledHistory(mode: SidebarMode): SidebarMode {
  return mode === 'history' ? 'working' : 'history';
}
function useRepositoryOperations(context: RepositoryActionContext) {
  const { repo, status, mode, selection, disabled, plan } = context;
  const openFile = useOpenFile(repo);
  const generating = isGenerating(useGeneration(repo));
  const fileTabs = useFileTabs(repo, mode);
  const entries = status?.entries ?? [];
  const selectedEntry = entries.find((entry) => entry.path === selection?.path);
  const moveFile = (direction: number) => {
    const filter = useFilterStore.getState().text[repo] ?? '';
    const files = changedFiles(entries, filter);
    const next = steppedFile({
      files: files,
      current: selection,
      direction: direction,
    });
    if (!next) return;
    useLayout.getState().update(repo, { mode: 'working' });
    openFile(next);
  };
  const changeSelectedFile = async (action: 'stage' | 'unstage') => {
    if (!selection) return;
    await perform('files_action', {
      repo: repo,
      paths: [selection.path],
      action: action,
    });
  };
  return {
    context: context,
    abilities: abilitiesOf(selectedEntry),
    workingDisabled: disabled || mode !== 'working',
    hasEntries: entries.length > 0,
    detached: isDetached(status?.branch),
    generating: generating,
    fileTabsCyclable: fileTabs.length > 1,
    moveFile: moveFile,
    changeSelectedFile: changeSelectedFile,
    discardSelected: async () => {
      if (selection) await discardFile(repo, selection.path);
    },
    cycleFileTab: (direction: number) =>
      useSelection.getState().cycleTab(repo, {
        mode: mode,
        direction: direction,
      }),
    commit: (commitMode: CommitMode) =>
      routeCommit({ repo: repo, mode: commitMode, plan: plan }),
  };
}
type RepositoryOperations = ReturnType<typeof useRepositoryOperations>;
function fileActions(operations: RepositoryOperations): Action[] {
  const { context, abilities, workingDisabled, hasEntries } = operations;
  return [
    {
      id: 'refresh',
      icon: <RotateCw className="size-3.5" />,
      label: 'Refresh repository',
      key: 'Mod+r',
      run: () => perform('refresh', { repo: context.repo }),
    },
    {
      id: 'stage',
      icon: <SquarePlus className="size-3.5" />,
      label: 'Stage selected file',
      key: 's',
      disabled: workingDisabled || !abilities.stage,
      run: () => operations.changeSelectedFile('stage'),
    },
    {
      id: 'unstage',
      icon: <SquareMinus className="size-3.5" />,
      label: 'Unstage selected file',
      key: 'u',
      disabled: workingDisabled || !abilities.unstage,
      run: () => operations.changeSelectedFile('unstage'),
    },
    {
      id: 'discard-file',
      icon: <Trash2 className="size-3.5" />,
      label: 'Discard selected file',
      key: 'Mod+Shift+d',
      disabled: workingDisabled || !abilities.discard,
      run: operations.discardSelected,
    },
    {
      id: 'next-file',
      icon: <ChevronRight className="size-3.5" />,
      label: 'Next changed file',
      key: 'Alt+ArrowRight',
      disabled: !hasEntries,
      run: () => operations.moveFile(NEXT),
    },
    {
      id: 'previous-file',
      icon: <ChevronLeft className="size-3.5" />,
      label: 'Previous changed file',
      key: 'Alt+ArrowLeft',
      disabled: !hasEntries,
      run: () => operations.moveFile(PREVIOUS),
    },
  ];
}
function commitActions(operations: RepositoryOperations): Action[] {
  const { context, detached } = operations;
  const { repo, disabled, plan } = context;
  const uncommittable = disabled || !plan.committable;
  return [
    {
      id: 'all',
      icon: <ListChecks className="size-3.5" />,
      label: 'Stage all changes',
      key: 'Mod+Shift+a',
      disabled: disabled,
      run: () =>
        perform('files_action', {
          repo: repo,
          paths: plan.changes,
          action: 'stage',
        }),
    },
    {
      id: 'commit',
      icon: <GitCommitHorizontal className="size-3.5" />,
      label: 'Commit changes',
      key: 'Mod+Enter',
      disabled: uncommittable,
      run: () => operations.commit('commit'),
    },
    {
      id: 'commit-push',
      icon: <Upload className="size-3.5" />,
      label: 'Commit and push changes',
      key: 'Mod+Shift+Enter',
      disabled: uncommittable || detached,
      run: () => operations.commit('commitPush'),
    },
    {
      id: 'generate-message',
      icon: <Sparkles className="size-3.5" />,
      label: 'Generate commit message',
      key: 'Mod+Alt+g',
      disabled: !aiConfigured(context.settings) || operations.generating,
      run: () => useGenerate.getState().generate(repo),
    },
  ];
}
function syncActions(operations: RepositoryOperations): Action[] {
  const { context, detached } = operations;
  const { repo, disabled, mode } = context;
  return [
    {
      id: 'fetch',
      icon: <RefreshCw className="size-3.5" />,
      label: 'Fetch',
      key: 'Mod+Shift+f',
      disabled: disabled,
      run: () => perform('sync', { repo: repo, action: 'fetch' }),
    },
    {
      id: 'pull',
      icon: <Download className="size-3.5" />,
      label: 'Pull',
      key: 'Mod+Shift+l',
      disabled: disabled || detached,
      run: () => pull(repo),
    },
    {
      id: 'push',
      icon: <Upload className="size-3.5" />,
      label: 'Push',
      key: 'Mod+Shift+u',
      disabled: disabled || detached,
      run: () => perform('sync', { repo: repo, action: 'push' }),
    },
    {
      id: 'history',
      icon: <History className="size-3.5" />,
      label: 'Toggle history',
      key: 'Mod+h',
      run: () =>
        useLayout.getState().update(repo, { mode: toggledHistory(mode) }),
    },
    {
      id: 'compare',
      icon: <GitCompare className="size-3.5" />,
      label: 'Compare branches',
      key: 'Mod+Shift+c',
      run: () => focusCompare(repo),
    },
    {
      id: 'stash',
      icon: <Archive className="size-3.5" />,
      label: 'Stash changes',
      key: 'Mod+Shift+s',
      disabled: disabled,
      run: context.startStash,
    },
  ];
}
function closeSelectedTab(context: RepositoryActionContext) {
  const { repo, mode, selection } = context;
  if (selection)
    useSelection.getState().closeTab(repo, mode, tabKey(selection));
}
function tabActions(operations: RepositoryOperations): Action[] {
  const { context, fileTabsCyclable } = operations;
  return [
    {
      id: 'close-file-tab',
      icon: <X className="size-3.5" />,
      label: 'Close file tab',
      key: 'Mod+w',
      disabled: !context.selection?.path,
      run: () => closeSelectedTab(context),
    },
    {
      id: 'next-file-tab',
      icon: <ChevronRight className="size-3.5" />,
      label: 'Next file tab',
      key: 'Ctrl+Tab',
      disabled: !fileTabsCyclable,
      run: () => operations.cycleFileTab(NEXT),
    },
    {
      id: 'previous-file-tab',
      icon: <ChevronLeft className="size-3.5" />,
      label: 'Previous file tab',
      key: 'Ctrl+Shift+Tab',
      disabled: !fileTabsCyclable,
      run: () => operations.cycleFileTab(PREVIOUS),
    },
    {
      id: 'next-tab',
      icon: <PanelRight className="size-3.5" />,
      label: 'Next repository',
      key: 'Mod+Alt+ArrowRight',
      run: () => useTabs.getState().cycle(NEXT),
    },
    {
      id: 'previous-tab',
      icon: <PanelLeft className="size-3.5" />,
      label: 'Previous repository',
      key: 'Mod+Alt+ArrowLeft',
      run: () => useTabs.getState().cycle(PREVIOUS),
    },
  ];
}
export function useRepositoryActions(context: RepositoryActionContext) {
  const operations = useRepositoryOperations(context);
  const actions: Action[] = [
    ...fileActions(operations),
    ...commitActions(operations),
    ...syncActions(operations),
    ...tabActions(operations),
  ];
  useActions(scopeKey(context.repo, 'repository'), actions);
  return actions;
}
