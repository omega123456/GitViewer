import type { RefObject } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { splitPath } from '../../lib/paths';
import type { Diff, Selection } from '../../lib/types';
import { useSelection } from '../../stores/selection';
import { clickable, dynamic, focus } from '../shared/styles';
import { StatusBadge } from '../sidebar/StatusBadge';
import { ImageDiff } from '../image/ImageDiff';
import { DiffSourcePill } from './DiffSourcePill';
import { DiffSurface, type DiffSurfaceHandle } from './DiffSurface';
import type { Found } from './find';
import { FullFileButton } from './DiffToolbar';
import { canEdit } from './editable';
import type { Expansion } from './expansion';
import {
  ChangeCountBadges,
  CopyPathButton,
  EditButton,
  OpenInSystemButton,
} from './DiffFileActions';
import type { ChangeCounts } from './useDiffFile';
import type { Row } from './rows';
import type { Tokens } from './tokens';
import { scopeKey } from '../../lib/git';
export interface StackFileHeaderState {
  open: boolean;
  data: Diff | undefined;
  counts: ChangeCounts;
  expansion: Expansion;
  onToggleOpen: () => void;
}
export function StackFileHeader({
  repo,
  selection,
  badge,
  state,
}: {
  repo: string;
  selection: Selection;
  badge: string | undefined;
  state: StackFileHeaderState;
}) {
  const { directory, name } = splitPath(selection.path);
  const Chevron = state.open ? ChevronDown : ChevronRight;
  return (
    <div className="sticky top-0 z-10 flex h-8.5 items-center gap-1 bg-sub pr-3 dark:bg-sub-dark">
      <button
        type="button"
        aria-expanded={state.open}
        onClick={state.onToggleOpen}
        className={`flex h-full min-w-0 flex-1 items-center gap-2 pl-3 text-sm ${clickable} ${focus}`}
      >
        <Chevron className="size-3.5 shrink-0 text-muted" />
        <span className="truncate" title={selection.path}>
          <span className="text-muted">{directory}</span>
          <span className="font-semibold">{name}</span>
        </span>
        <DiffSourcePill selection={selection} />
        <ChangeCountBadges counts={state.counts} />
        {badge && <StatusBadge status={badge} />}
      </button>
      {state.open && state.expansion.available && (
        <FullFileButton
          full={state.expansion.full}
          toggle={state.expansion.toggleFull}
        />
      )}
      <CopyPathButton path={selection.path} />
      <OpenInSystemButton repo={repo} path={selection.path} />
      {canEdit(selection.source, badge, state.data) && (
        <EditButton
          title="Edit this file"
          label="Edit"
          onClick={() =>
            useSelection
              .getState()
              .select(repo, { ...selection, editing: true })
          }
        />
      )}
    </div>
  );
}
export interface StackFileBodyState {
  data: Diff | undefined;
  message: string | null;
  mounted: boolean;
  reserved: number;
  version: number;
  rows: Row[];
  split: boolean;
  tokens: Tokens;
  marked: Found | undefined;
  disabled: boolean;
  hunkAction: (hunk: number, action: string) => void;
  scroller: RefObject<HTMLDivElement | null>;
  margin: number;
  expansion: Expansion;
}
function StackFileContent({
  repo,
  selection,
  data,
  handleRef,
  state,
}: {
  repo: string;
  selection: Selection;
  data: Diff;
  handleRef: RefObject<DiffSurfaceHandle | null>;
  state: StackFileBodyState;
}) {
  if (data.image)
    return (
      <div className="flex flex-col">
        <ImageDiff
          repo={repo}
          view={scopeKey(repo, selection.path)}
          selection={selection}
          diff={data}
          version={state.version}
        />
      </div>
    );
  return (
    <DiffSurface
      ref={handleRef}
      found={state.marked}
      rows={state.rows}
      diff={data}
      display={{ split: state.split, wrap: false, whitespace: false }}
      tokens={state.tokens}
      controls={{
        source: selection.source,
        disabled: state.disabled,
        act: state.hunkAction,
      }}
      embedding={{ scroller: state.scroller, margin: state.margin }}
      expansion={state.expansion}
    />
  );
}
export function StackFileBody({
  repo,
  selection,
  bodyRef,
  handleRef,
  state,
}: {
  repo: string;
  selection: Selection;
  bodyRef: RefObject<HTMLDivElement | null>;
  handleRef: RefObject<DiffSurfaceHandle | null>;
  state: StackFileBodyState;
}) {
  if (state.message || !state.data)
    return (
      <p
        className={`px-3 py-2 text-xs text-muted ${state.data ? '' : 'min-h-32'}`}
      >
        {state.message}
      </p>
    );
  if (!state.mounted && !state.data.image)
    return (
      <p
        className="h-virtual px-3 py-2 text-xs text-muted"
        style={dynamic({ '--virtual-height': `${state.reserved}px` })}
      >
        Loading…
      </p>
    );
  return (
    <div ref={bodyRef}>
      <StackFileContent
        repo={repo}
        selection={selection}
        data={state.data}
        handleRef={handleRef}
        state={state}
      />
    </div>
  );
}
