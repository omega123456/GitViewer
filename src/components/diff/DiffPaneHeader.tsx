import { Eye, History, User } from 'lucide-react';
import { splitPath } from '../../lib/paths';
import type { Selection } from '../../lib/types';
import { Button } from '../shared/Button';
import { accentToggle, paneHeader } from '../shared/styles';
import { FileIcon } from '../sidebar/FileIcon';
import { StatusBadge } from '../sidebar/StatusBadge';
import {
  ChangeCountBadges,
  CopyPathButton,
  EditButton,
  OpenInSystemButton,
} from './DiffFileActions';
import { DiffSourcePill } from './DiffSourcePill';
import { openFileHistory } from './diff-actions';
import type { ChangeCounts } from './useDiffFile';
export interface DiffHeaderState {
  dirty: boolean;
  counts: ChangeCounts;
  letter: string | undefined;
  markdown: boolean;
  rendered: boolean;
  tooLarge: boolean;
  editable: boolean;
  editing: boolean;
  onToggleRendered: () => void;
  onToggleBlame: () => void;
  onToggleEdit: () => void;
}
function EditToggleButton({
  editable,
  editing,
  onToggleEdit,
}: {
  editable: boolean;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  if (!editable)
    return (
      <EditButton
        aria-hidden
        tabIndex={-1}
        disabled
        className="invisible"
        label="Edit"
        labelClassName="min-w-7"
      />
    );
  return (
    <EditButton
      aria-pressed={editing}
      className={editing ? accentToggle : ''}
      onClick={onToggleEdit}
      label={editing ? 'Diff' : 'Edit'}
      labelClassName="min-w-7"
    />
  );
}
function DiffHeaderActions({
  repo,
  selection,
  state,
}: {
  repo: string;
  selection: Selection;
  state: DiffHeaderState;
}) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <OpenInSystemButton repo={repo} path={selection.path} />
      <Button
        title="File history"
        onClick={() => openFileHistory(repo, selection.path)}
      >
        <History className="size-4" />
        <span>History</span>
      </Button>
      {state.markdown && (
        <Button
          title={
            state.rendered ? 'Show the source diff' : 'Show rendered Markdown'
          }
          disabled={state.tooLarge}
          onClick={state.onToggleRendered}
        >
          <Eye className="size-4" />
          <span className="min-w-16">
            {state.rendered ? 'Source' : 'Rendered'}
          </span>
        </Button>
      )}
      <Button onClick={state.onToggleBlame}>
        <User className="size-4" />
        <span className="min-w-10.5">{selection.blame ? 'Diff' : 'Blame'}</span>
      </Button>
      <EditToggleButton
        editable={state.editable}
        editing={state.editing}
        onToggleEdit={state.onToggleEdit}
      />
    </div>
  );
}
export function DiffPaneHeader({
  repo,
  selection,
  state,
}: {
  repo: string;
  selection: Selection;
  state: DiffHeaderState;
}) {
  const { directory, name } = splitPath(selection.path);
  return (
    <header className={paneHeader}>
      <span className="mr-1 flex">
        <FileIcon name={name} directory={false} />
      </span>
      <span className="truncate text-sm" title={selection.path}>
        <span className="text-muted dark:text-muted-dark">{directory}</span>
        <span className="font-semibold">{name}</span>
      </span>
      {state.dirty && (
        <span
          role="img"
          aria-label="Unsaved changes"
          className="size-status-dot shrink-0 rounded-full bg-accent dark:bg-accent-dark"
        />
      )}
      <CopyPathButton path={selection.path} />
      <DiffSourcePill selection={selection} />
      <ChangeCountBadges counts={state.counts} />
      <DiffHeaderActions repo={repo} selection={selection} state={state} />
      <span className="flex w-3.5 shrink-0">
        {state.letter && <StatusBadge status={state.letter} />}
      </span>
    </header>
  );
}
