import { GitMerge } from 'lucide-react';
import { memo, useState } from 'react';
import { commitPlan, routeCommit } from '../../lib/commit';
import { isDetached } from '../../lib/git';
import { perform, useBackend } from '../../lib/query';
import type { Selection, SettingsResponse, Status } from '../../lib/types';
import { pluralWord } from '../../lib/text';
import { useBusy } from '../../stores/activity';
import { useHasMessage } from '../../stores/tabs';
import {
  useLayout,
  useSidebarMode,
  useSidebarWidth,
  sidebarWidthBounds,
  type SidebarMode,
} from '../../stores/layout';
import {
  useAllChanges,
  useCurrentSelection,
  type Stack,
} from '../../stores/selection';
import { Button } from '../shared/Button';
import { dynamic } from '../shared/styles';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { AllChangesPane } from '../diff/AllChangesPane';
import { DiffPane } from '../diff/DiffPane';
import { FileTabStrip } from '../diff/FileTabStrip';
import { CommitList } from '../history/CommitList';
import { ChangesSection } from '../sidebar/ChangesSection';
import { CompareSection } from '../sidebar/CompareSection';
import { CommitFooter } from '../sidebar/CommitFooter';
import { FilesSection } from '../sidebar/FilesSection';
import { SidebarModeToggle } from '../sidebar/SidebarModeToggle';
import { StashDialog } from '../stash/StashDialog';
import { StashSection } from '../stash/StashSection';
import { ResizeHandle } from './ResizeHandle';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { useRepositoryActions } from './useRepositoryActions';
interface ViewProps {
  repo: string;
  settings: SettingsResponse;
  version: string;
}
function useRepositoryState({ repo, settings }: ViewProps) {
  const query = useBackend('status', { repo });
  const busy = useBusy(repo);
  const hasMessage = useHasMessage(repo);
  const mode = useSidebarMode(repo);
  const select = useCurrentSelection(repo, mode);
  const sidebarWidth = useSidebarWidth(repo);
  const all = useAllChanges(repo);
  const status = query.data;
  const [naming, setNaming] = useState(false);
  const disabled = busy || !status || status.conflicted;
  const plan = commitPlan({
    entries: status?.entries ?? [],
    hasMessage: hasMessage,
    smartCommit: settings.smartCommit,
  });
  const actions = useRepositoryActions({
    repo: repo,
    settings: settings,
    status: status,
    mode: mode,
    selection: select,
    disabled: disabled,
    plan: plan,
    startStash: () => setNaming(true),
  });
  return {
    query: query,
    busy: busy,
    mode: mode,
    select: select,
    sidebarWidth: sidebarWidth,
    all: all,
    naming: naming,
    setNaming: setNaming,
    disabled: disabled,
    plan: plan,
    actions: actions,
  };
}
type RepositoryState = ReturnType<typeof useRepositoryState>;
interface ReadyView {
  props: ViewProps;
  state: RepositoryState;
  status: Status;
}
function conflictCount(status: Status) {
  return status.entries.filter((entry) => entry.kind === 'unmerged').length;
}
function MergeNotice({ view, merging }: { view: ReadyView; merging: string }) {
  const conflicts = conflictCount(view.status);
  return (
    <>
      <GitMerge className="size-3.5 shrink-0" />
      <span>
        Merging {merging} into {view.status.branch}. {conflicts}{' '}
        {pluralWord(conflicts, 'path conflicts', 'paths conflict')} — resolve
        them in your editor, then finish the merge from a terminal.
      </span>
      <Button
        className="ml-auto border border-current"
        disabled={view.state.busy}
        onClick={() => void perform('merge_abort', { repo: view.props.repo })}
      >
        Abort merge
      </Button>
    </>
  );
}
function ConflictNotice({ view }: { view: ReadyView }) {
  const { merging } = view.status;
  if (merging) return <MergeNotice view={view} merging={merging} />;
  return (
    <span>
      {conflictCount(view.status)} paths have conflicts. Resolve them in a
      terminal. This repository is read-only.
    </span>
  );
}
function ConflictBanner({ view }: { view: ReadyView }) {
  const { status } = view;
  if (!status.conflicted) return null;
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 px-3 py-2 text-sm ${status.merging ? 'bg-merge text-merge-ink dark:bg-merge-dark dark:text-merge-ink-dark' : 'bg-remove text-remove-ink dark:bg-remove-dark dark:text-remove-ink-dark'}`}
    >
      <ConflictNotice view={view} />
    </div>
  );
}
function WorkingSidebar({ view }: { view: ReadyView }) {
  const { props, state, status } = view;
  const { repo } = props;
  return (
    <div
      className={
        state.mode === 'working'
          ? 'flex min-h-0 flex-1 flex-col overflow-y-auto'
          : 'hidden'
      }
    >
      <ChangesSection repo={repo} status={status} disabled={state.disabled} />
      <FilesSection repo={repo} status={status} />
      <StashSection repo={repo} disabled={state.disabled} />
    </div>
  );
}
function WorkingCommit({ view }: { view: ReadyView }) {
  const { props, state, status } = view;
  if (state.mode !== 'working') return null;
  return (
    <CommitFooter
      repo={props.repo}
      status={status}
      settings={props.settings}
      disabled={state.disabled || !state.plan.committable}
      pushable={!isDetached(status.branch)}
      commit={(commitMode) =>
        void routeCommit({
          repo: props.repo,
          mode: commitMode,
          plan: state.plan,
        })
      }
    />
  );
}
function Sidebar({ view, width }: { view: ReadyView; width: number }) {
  const { props, state, status } = view;
  return (
    <aside
      className="@container flex w-sidebar shrink-0 flex-col bg-sub dark:bg-sub-dark"
      style={dynamic({ '--sidebar-width': `${width}px` })}
    >
      <SidebarModeToggle repo={props.repo} />
      <WorkingSidebar view={view} />
      <div
        className={
          state.mode === 'history' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'
        }
      >
        <CommitList repo={props.repo} />
      </div>
      {state.mode === 'compare' && (
        <CompareSection repo={props.repo} status={status} />
      )}
      <WorkingCommit view={view} />
    </aside>
  );
}
function SidebarResize({ view, width }: { view: ReadyView; width: number }) {
  const { repo } = view.props;
  const working = view.state.mode === 'working';
  return (
    <ResizeHandle
      label="Resize sidebar"
      orientation="horizontal"
      bounds={sidebarWidthBounds}
      value={width}
      className="w-1 shrink-0 cursor-col-resize bg-line hover:bg-accent focus-visible:bg-accent dark:bg-line-dark"
      measure={(event) => event.clientX}
      onChange={(next) =>
        useLayout
          .getState()
          .update(repo, working ? { width: next } : { historyWidth: next })
      }
    />
  );
}
function showsAllChanges(
  all: Stack | undefined,
  mode: SidebarMode,
  selection?: Selection,
) {
  if (!all) return false;
  if (all === 'commit')
    return mode !== 'compare' && Boolean(selection?.revision);
  if (all === 'compare') return mode === 'compare';
  return mode === 'working';
}
function DiffArea({ view }: { view: ReadyView }) {
  const { props, state, status } = view;
  const { repo, settings } = props;
  const { select, disabled, all } = state;
  if (all && showsAllChanges(all, state.mode, select))
    return (
      <AllChangesPane
        repo={repo}
        stack={all}
        commit={select}
        status={status}
        settings={settings}
        disabled={disabled}
      />
    );
  return (
    <DiffPane
      repo={repo}
      selection={select?.path ? select : undefined}
      settings={settings}
      disabled={disabled}
    />
  );
}
function RepositoryBody({ view }: { view: ReadyView }) {
  const { props, state, status } = view;
  const width = state.sidebarWidth;
  return (
    <>
      <Toolbar
        repo={props.repo}
        status={status}
        disabled={state.disabled}
        actions={state.actions}
      />
      <StashDialog
        repo={props.repo}
        open={state.naming}
        onOpenChange={state.setNaming}
      />
      <ConflictBanner view={view} />
      <div className="flex min-h-0 flex-1">
        <Sidebar view={view} width={width} />
        <SidebarResize view={view} width={width} />
        <div className="flex min-w-0 flex-1 flex-col">
          <FileTabStrip repo={props.repo} mode={state.mode} />
          <div className="min-h-0 flex-1">
            <DiffArea view={view} />
          </div>
        </div>
      </div>
      <StatusBar repo={props.repo} status={status} version={props.version} />
    </>
  );
}
export const RepositoryView = memo(function RepositoryView(props: ViewProps) {
  const state = useRepositoryState(props);
  const { query } = state;
  if (query.error)
    return (
      <ErrorState
        title="Could not read the repository"
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  const status = query.data;
  if (!status) return <State title="Loading repository…" />;
  return (
    <RepositoryBody view={{ props: props, state: state, status: status }} />
  );
});
