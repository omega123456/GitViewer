import {
  ChevronDown,
  ChevronUp,
  Columns2,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  Pencil,
  Save,
  SquareMinus,
  SquarePlus,
  Trash2,
  UnfoldVertical,
  User,
  WrapText,
} from 'lucide-react';
import type { Action } from '../../lib/keyboard';
import type { Diff, Selection, Settings } from '../../lib/types';
import { useDiffView } from '../../stores/diff-view';
import { save } from '../../stores/editor';
import { useLayout } from '../../stores/layout';
import { useSelection } from '../../stores/selection';
import { openInSystem } from './DiffFileActions';
import { findActions } from './FindBar';
import type { Find } from './find';
export function openFileHistory(repo: string, path: string) {
  useLayout.getState().update(repo, { mode: 'history' });
  useSelection.getState().setPath(repo, path);
}
export function markdownPreview(data: Diff | undefined, rendered: boolean) {
  if (!data || !rendered) return { text: '', deleted: false };
  if (data.content !== null) return { text: data.content, deleted: false };
  const all = data.hunks.flatMap((hunk) => hunk.lines);
  const kept = all.filter((line) => line.kind !== 'remove');
  const deleted = all.length > 0 && kept.length === 0;
  return {
    text: (deleted ? all : kept).map((line) => line.content).join('\n'),
    deleted: deleted,
  };
}
export interface DiffActionContext {
  repo: string;
  selection: Selection;
  data: Diff | undefined;
  disabled: boolean;
  mode: Settings['diffMode'];
  editing: boolean;
  editable: boolean;
  dirty: boolean;
  markdown: boolean;
  rendered: boolean;
  expansionAvailable: boolean;
  find: Find;
  move: (direction: number) => void;
  stageHunk: () => void;
  discardHunk: () => void;
  toggleEdit: () => void;
  toggleBlame: () => void;
  toggleRendered: () => void;
  toggleWrap: () => void;
  toggleWhitespace: () => void;
  toggleFull: () => void;
}
function hunkActions(context: DiffActionContext): Action[] {
  const { selection, data, disabled, move, stageHunk, discardHunk } = context;
  const hasHunks = Boolean(data?.hunks.length);
  const isStaged = selection.source === 'staged';
  const stageable = ['staged', 'unstaged'].includes(selection.source);
  return [
    {
      id: 'next-hunk',
      icon: <ChevronDown className="size-3.5" />,
      label: 'Next change',
      key: 'Alt+ArrowDown',
      run: () => move(1),
      disabled: !hasHunks,
    },
    {
      id: 'previous-hunk',
      icon: <ChevronUp className="size-3.5" />,
      label: 'Previous change',
      key: 'Alt+ArrowUp',
      run: () => move(-1),
      disabled: !hasHunks,
    },
    {
      id: 'stage-hunk',
      icon: isStaged ? (
        <SquareMinus className="size-3.5" />
      ) : (
        <SquarePlus className="size-3.5" />
      ),
      label: isStaged ? 'Unstage hunk' : 'Stage hunk',
      key: 'Mod+Alt+s',
      run: stageHunk,
      disabled: disabled || !hasHunks || !stageable,
    },
    {
      id: 'discard-hunk',
      icon: <Trash2 className="size-3.5" />,
      label: 'Discard hunk',
      key: 'Mod+Alt+d',
      run: discardHunk,
      disabled: disabled || !hasHunks || selection.source !== 'unstaged',
    },
  ];
}
function fileActions(context: DiffActionContext): Action[] {
  const { repo, selection, editable, editing, dirty, toggleEdit, toggleBlame } =
    context;
  const file = { repo: repo, path: selection.path };
  return [
    {
      id: 'edit',
      icon: <Pencil className="size-3.5" />,
      label: 'Toggle edit mode',
      key: 'Mod+Alt+e',
      run: toggleEdit,
      disabled: !editable,
    },
    {
      id: 'save-file',
      icon: <Save className="size-3.5" />,
      label: 'Save file',
      key: 'Mod+s',
      run: () => save(file),
      disabled: !editing || !dirty,
    },
    {
      id: 'open-file',
      icon: <ExternalLink className="size-3.5" />,
      label: 'Open in system application',
      key: 'Mod+e',
      run: () => openInSystem(repo, selection.path),
    },
    {
      id: 'file-history',
      icon: <History className="size-3.5" />,
      label: 'File history',
      key: 'Mod+Alt+h',
      run: () => openFileHistory(repo, selection.path),
    },
    {
      id: 'blame',
      icon: <User className="size-3.5" />,
      label: 'Toggle blame',
      key: 'Mod+Alt+b',
      run: toggleBlame,
    },
  ];
}
function viewActions(context: DiffActionContext): Action[] {
  const {
    data,
    mode,
    markdown,
    expansionAvailable,
    toggleRendered,
    toggleWrap,
    toggleWhitespace,
    toggleFull,
  } = context;
  return [
    {
      id: 'rendered',
      icon: <Eye className="size-3.5" />,
      label: 'Toggle rendered Markdown',
      key: 'Mod+Shift+v',
      run: toggleRendered,
      disabled: !markdown || data?.tooLarge === true,
    },
    {
      id: 'wrap',
      icon: <WrapText className="size-3.5" />,
      label: 'Toggle word wrap',
      key: 'Alt+z',
      run: toggleWrap,
    },
    {
      id: 'whitespace',
      icon: <EyeOff className="size-3.5" />,
      label: 'Toggle whitespace',
      key: 'Mod+Alt+w',
      run: toggleWhitespace,
    },
    {
      id: 'context',
      icon: <UnfoldVertical className="size-3.5" />,
      label: 'Show or hide full file',
      key: 'Mod+Alt+c',
      run: toggleFull,
      disabled: !expansionAvailable,
    },
    {
      id: 'diff-mode',
      icon: <Columns2 className="size-3.5" />,
      label: 'Toggle split and unified diff',
      key: 'Mod+Alt+v',
      run: () =>
        useDiffView.getState().setMode(mode === 'split' ? 'unified' : 'split'),
    },
  ];
}
export function diffPaneActions(context: DiffActionContext): Action[] {
  const search = context.editing
    ? []
    : findActions(context.find, context.rendered);
  return [
    ...search,
    ...hunkActions(context),
    ...fileActions(context),
    ...viewActions(context),
  ];
}
