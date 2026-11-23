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
import { useFileTabLimit } from '../../lib/settings';
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
export function useRepositoryActions(context: RepositoryActionContext) {
  const { repo, settings, status, mode, selection, disabled, plan } = context;
  const openFile = useOpenFile(repo);
  const limit = useFileTabLimit();
  const generating = isGenerating(useGeneration(repo));
  const fileTabs = useFileTabs(repo, mode);
  const entries = status?.entries ?? [];
  const selectedEntry = entries.find((entry) => entry.path === selection?.path);
  const abilities = abilitiesOf(selectedEntry);
  const workingDisabled = disabled || mode !== 'working';
  const fileTabsCyclable = fileTabs.length > 1;
  const detached = isDetached(status?.branch);
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
  const discardSelected = async () => {
    if (selection) await discardFile(repo, selection.path);
  };
  const cycleFileTab = (direction: number) =>
    useSelection.getState().cycleTab(repo, {
      mode: mode,
      direction: direction,
      limit: limit,
    });
  const commit = (commitMode: CommitMode) =>
    routeCommit({ repo: repo, mode: commitMode, plan: plan });
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
      disabled: workingDisabled || !abilities.stage,
      run: () => changeSelectedFile('stage'),
    },
    {
      id: 'unstage',
      icon: <SquareMinus className="size-3.5" />,
      label: 'Unstage selected file',
      key: 'u',
      disabled: workingDisabled || !abilities.unstage,
      run: () => changeSelectedFile('unstage'),
    },
    {
      id: 'discard-file',
      icon: <Trash2 className="size-3.5" />,
      label: 'Discard selected file',
      key: 'Mod+Shift+d',
      disabled: workingDisabled || !abilities.discard,
      run: discardSelected,
    },
    {
      id: 'next-file',
      icon: <ChevronRight className="size-3.5" />,
      label: 'Next changed file',
      key: 'Alt+ArrowRight',
      disabled: !entries.length,
      run: () => moveFile(NEXT),
    },
    {
      id: 'previous-file',
      icon: <ChevronLeft className="size-3.5" />,
      label: 'Previous changed file',
      key: 'Alt+ArrowLeft',
      disabled: !entries.length,
      run: () => moveFile(PREVIOUS),
    },
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
      disabled: disabled || !plan.committable,
      run: () => commit('commit'),
    },
    {
      id: 'commit-push',
      icon: <Upload className="size-3.5" />,
      label: 'Commit and push changes',
      key: 'Mod+Shift+Enter',
      disabled: disabled || !plan.committable || detached,
      run: () => commit('commitPush'),
    },
    {
      id: 'generate-message',
      icon: <Sparkles className="size-3.5" />,
      label: 'Generate commit message',
      key: 'Mod+Alt+g',
      disabled: !aiConfigured(settings) || generating,
      run: () => useGenerate.getState().generate(repo),
    },
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
    {
      id: 'close-file-tab',
      icon: <X className="size-3.5" />,
      label: 'Close file tab',
      key: 'Mod+w',
      disabled: !selection?.path,
      run: () =>
        selection &&
        useSelection.getState().closeTab(repo, mode, tabKey(selection)),
    },
    {
      id: 'next-file-tab',
      icon: <ChevronRight className="size-3.5" />,
      label: 'Next file tab',
      key: 'Ctrl+Tab',
      disabled: !fileTabsCyclable,
      run: () => cycleFileTab(NEXT),
    },
    {
      id: 'previous-file-tab',
      icon: <ChevronLeft className="size-3.5" />,
      label: 'Previous file tab',
      key: 'Ctrl+Shift+Tab',
      disabled: !fileTabsCyclable,
      run: () => cycleFileTab(PREVIOUS),
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
  useActions(scopeKey(repo, 'repository'), actions);
  return actions;
}
