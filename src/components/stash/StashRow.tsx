import { Archive, Copy, CopyMinus, Trash2 } from 'lucide-react';
import { elapsedTime } from '../../lib/time';
import { useBackend } from '../../lib/query';
import { applyStash, dropStash } from '../../lib/stash';
import type { Selection, Stash } from '../../lib/types';
import { runs, type Activity } from '../../stores/activity';
import {
  useLayout,
  useLayoutField,
  stashFilesHeightBounds,
} from '../../stores/layout';
import { Button } from '../shared/Button';
import { ViewAllButton } from '../shared/ViewAllButton';
import { ErrorRetry } from '../states/Errors';
import { GroupHeader } from '../shared/Section';
import { BusyIcon } from '../shared/BusyIcon';
import {
  dynamic,
  pill,
  pinnedSlot,
  revealSlot,
  rowTint,
  selectedRow,
  removedInk,
} from '../shared/styles';
import { SectionResizeHandle } from '../shell/ResizeHandle';
import { RevisionTree } from '../sidebar/RevisionTree';
import { revisionTree } from '../sidebar/reveal';
function StashActionButton({
  label,
  busy,
  disabled,
  icon,
  className = '',
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  icon: typeof Copy;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="icon"
      className={`size-6 ${className}`}
      aria-busy={busy}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <BusyIcon busy={busy} icon={icon} className="size-3" />
    </Button>
  );
}
function StashRowActions({
  repo,
  stash,
  selected,
  disabled,
  activity,
}: {
  repo: string;
  stash: Stash;
  selected: boolean;
  disabled: boolean;
  activity: Activity | undefined;
}) {
  const applying = runs(activity, 'stash_apply', {
    hash: stash.hash,
    pop: false,
  });
  const popping = runs(activity, 'stash_apply', {
    hash: stash.hash,
    pop: true,
  });
  const dropping = runs(activity, 'stash_drop', { hash: stash.hash });
  const pinned = selected || applying || popping || dropping;
  return (
    <div className={`${pinned ? pinnedSlot : revealSlot} right-1`}>
      <StashActionButton
        label={`Apply ${stash.selector}`}
        busy={applying}
        disabled={disabled}
        icon={Copy}
        onClick={() =>
          void applyStash({ repo: repo, hash: stash.hash, pop: false })
        }
      />
      <StashActionButton
        label={`Pop ${stash.selector}`}
        busy={popping}
        disabled={disabled}
        icon={CopyMinus}
        onClick={() =>
          void applyStash({ repo: repo, hash: stash.hash, pop: true })
        }
      />
      <span className="w-1.5 shrink-0" />
      <StashActionButton
        label={`Drop ${stash.selector}`}
        busy={dropping}
        disabled={disabled}
        icon={Trash2}
        className={removedInk}
        onClick={() => void dropStash(repo, stash.hash)}
      />
    </div>
  );
}
export function StashRow({
  repo,
  stash,
  selected,
  disabled,
  activity,
  onSelect,
}: {
  repo: string;
  stash: Stash;
  selected: boolean;
  disabled: boolean;
  activity: Activity | undefined;
  onSelect: () => void;
}) {
  return (
    <div
      className={`group relative mx-1 flex items-center rounded ${rowTint} ${selected ? selectedRow : ''}`}
    >
      {selected && <span className={pill} />}
      <Button
        className="h-tree-comfortable w-full justify-start truncate text-left"
        onClick={onSelect}
      >
        <Archive className="size-3.75 shrink-0 text-muted dark:text-muted-dark" />
        <span className="min-w-0 flex-1 truncate">{stash.message}</span>
        <span className="shrink-0 font-mono text-badge text-muted dark:text-muted-dark">
          {elapsedTime(stash.timestamp)}
        </span>
      </Button>
      <StashRowActions
        repo={repo}
        stash={stash}
        selected={selected}
        disabled={disabled}
        activity={activity}
      />
    </div>
  );
}
interface StashFilesPaneProps {
  repo: string;
  selected: string;
  selection: Selection | undefined;
  onShow: (path: string) => void;
}
export function StashFilesPane({
  repo,
  selected,
  selection,
  onShow,
}: StashFilesPaneProps) {
  const stashFilesHeight = useLayoutField(repo, 'stashFilesHeight');
  const files = useBackend('commit_files', {
    repo: repo,
    revision: selected,
    source: 'stash',
  });
  const paths = Object.keys(files.data?.statuses ?? {});
  const showingThisStash =
    selection?.source === 'stash' && selection.revision === selected;
  const viewAll = (
    <ViewAllButton
      repo={repo}
      stack="commit"
      label="All changes in stash"
      look="section"
    />
  );
  return (
    <>
      <SectionResizeHandle
        label="Resize stash files"
        bounds={stashFilesHeightBounds}
        value={stashFilesHeight}
        onChange={(next) =>
          useLayout.getState().update(repo, { stashFilesHeight: next })
        }
      />
      <div
        className="flex h-stash-files min-h-0 shrink-0 flex-col"
        style={dynamic({ '--stash-files-height': `${stashFilesHeight}%` })}
      >
        <GroupHeader
          title="Stash files"
          count={paths.length}
          actions={viewAll}
        />
        <ErrorRetry label="Could not load the stash files" query={files} />
        {files.data && (
          <RevisionTree
            key={selected}
            repo={repo}
            tree={revisionTree({ source: 'stash', revision: selected })}
            label="Stash files"
            paths={paths}
            statuses={files.data.statuses}
            selectedPath={showingThisStash ? selection.path : undefined}
            onSelect={onShow}
          />
        )}
      </div>
    </>
  );
}
