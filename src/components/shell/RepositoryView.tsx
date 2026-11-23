import { GitMerge } from 'lucide-react';
import { memo, useState } from 'react';
import { commitPlan, routeCommit } from '../../lib/commit';
import { isDetached } from '../../lib/git';
import { perform, useBackend } from '../../lib/query';
import type { SettingsResponse } from '../../lib/types';
import { pluralWord } from '../../lib/text';
import { useBusy } from '../../stores/activity';
import { useHasMessage } from '../../stores/tabs';
import {
  useLayout,
  useSidebarMode,
  useSidebarWidth,
  sidebarWidthBounds,
} from '../../stores/layout';
import { useAllChanges, useCurrentSelection } from '../../stores/selection';
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
export const RepositoryView = memo(function RepositoryView({
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
  const hasMessage = useHasMessage(repo);
  const mode = useSidebarMode(repo);
  const sidebarWidth = useSidebarWidth(repo);
  const select = useCurrentSelection(repo, mode);
  const all = useAllChanges(repo);
  const status = query.data;
  const [naming, setNaming] = useState(false);
  const disabled = busy || !status || status.conflicted;
  const conflicts = (status?.entries ?? []).filter(
    (entry) => entry.kind === 'unmerged',
  ).length;
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
      <StashDialog repo={repo} open={naming} onOpenChange={setNaming} />
      {status.conflicted && (
        <div
          role="alert"
          className={`flex items-center gap-2 px-3 py-2 text-sm ${status.merging ? 'bg-merge text-merge-ink dark:bg-merge-dark dark:text-merge-ink-dark' : 'bg-remove text-remove-ink dark:bg-remove-dark dark:text-remove-ink-dark'}`}
        >
          {status.merging ? (
            <>
              <GitMerge className="size-3.5 shrink-0" />
              <span>
                Merging {status.merging} into {status.branch}. {conflicts}{' '}
                {pluralWord(conflicts, 'path conflicts', 'paths conflict')} —
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
          className="@container flex w-sidebar shrink-0 flex-col bg-sub dark:bg-sub-dark"
          style={dynamic({ '--sidebar-width': `${sidebarWidth}px` })}
        >
          <SidebarModeToggle repo={repo} />
          <div
            className={
              mode === 'working'
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
              mode === 'history' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'
            }
          >
            <CommitList repo={repo} />
          </div>
          {mode === 'compare' && <CompareSection repo={repo} status={status} />}
          {mode === 'working' && (
            <CommitFooter
              repo={repo}
              status={status}
              settings={settings}
              disabled={disabled || !plan.committable}
              pushable={!isDetached(status.branch)}
              commit={(commitMode) =>
                void routeCommit({ repo: repo, mode: commitMode, plan: plan })
              }
            />
          )}
        </aside>
        <ResizeHandle
          label="Resize sidebar"
          orientation="horizontal"
          bounds={sidebarWidthBounds}
          value={sidebarWidth}
          className="w-1 shrink-0 cursor-col-resize bg-line hover:bg-accent focus-visible:bg-accent dark:bg-line-dark"
          measure={(event) => event.clientX}
          onChange={(width) =>
            useLayout
              .getState()
              .update(
                repo,
                mode === 'working' ? { width } : { historyWidth: width },
              )
          }
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <FileTabStrip repo={repo} mode={mode} />
          <div className="min-h-0 flex-1">
            {all &&
            (all === 'commit'
              ? mode !== 'compare' && select?.revision
              : all === 'compare'
                ? mode === 'compare'
                : mode === 'working') ? (
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
      </div>
      <StatusBar repo={repo} status={status} version={version} />
    </>
  );
});
