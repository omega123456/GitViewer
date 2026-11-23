import { memo } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { CheckCircle2, Loader2 } from 'lucide-react';
import type { Selection, Settings, Status } from '../../lib/types';
import { CompareError, SameRefState } from '../sidebar/CompareSection';
import type { Stack } from '../../stores/selection';
import { Spinner } from '../shared/Spinner';
import { VirtualCanvas } from '../shared/VirtualCanvas';
import {
  addedInk,
  dynamic,
  focusInset,
  paneHeader,
  removedInk,
} from '../shared/styles';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { FindBar } from './FindBar';
import type { LineFound, Located } from './find';
import type { Openings } from './expansion';
import { scrollPage } from './scroll';
import { shortHash } from '../../lib/git';
import type { StackEntry } from './stack-entries';
import { FileDiff, type PaneContext } from './StackFileDiff';
import { useAllChangesController } from './useStackPane';
const titles: Record<Stack, string> = {
  staged: 'Staged changes',
  unstaged: 'Changes',
  commit: 'Commit',
  compare: 'Branch comparison',
};
const labels: Record<Stack, string> = {
  staged: 'All staged changes',
  unstaged: 'All changes',
  commit: 'All changes in commit',
  compare: 'All changes between branches',
};
function StackHeaderSummary({
  stack,
  listing,
  count,
  totals,
}: {
  stack: Stack;
  listing: boolean;
  count: number;
  totals: { additions: number; deletions: number };
}) {
  if (stack === 'compare' && !listing)
    return (
      <span className="ml-auto shrink-0 font-mono text-badge text-muted">
        {count} files · <span className={addedInk}>+{totals.additions}</span>{' '}
        <span className={removedInk}>−{totals.deletions}</span>
      </span>
    );
  if (listing) return <Spinner className="size-3.5 text-muted" />;
  return <span className="font-mono text-badge text-muted">{count}</span>;
}
function StackHeader({
  stack,
  commit,
  listing,
  count,
  compare,
}: {
  stack: Stack;
  commit: Selection | undefined;
  listing: boolean;
  count: number;
  compare: {
    base: string;
    target: string;
    totals: { additions: number; deletions: number };
  };
}) {
  const stashed = commit?.source === 'stash';
  return (
    <header className={paneHeader}>
      <span className="font-semibold">{stashed ? 'Stash' : titles[stack]}</span>
      {commit?.revision && (
        <span className="font-mono text-badge text-muted">
          {shortHash(commit.revision)}
        </span>
      )}
      {stack === 'compare' && (
        <span className="truncate font-mono text-badge">
          {compare.base}{' '}
          <span className="text-faint dark:text-faint-dark">→</span>{' '}
          {compare.target}
        </span>
      )}
      <StackHeaderSummary
        stack={stack}
        listing={listing}
        count={count}
        totals={compare.totals}
      />
    </header>
  );
}
interface StackListProps {
  virtual: Virtualizer<HTMLDivElement, Element>;
  ordered: StackEntry[];
  pane: PaneContext;
  closed: Record<string, boolean>;
  openings: Record<string, Openings>;
  located: Map<string, LineFound>;
  jump: Located | undefined;
}
function StackFileList({ list }: { list: StackListProps }) {
  return (
    <VirtualCanvas height={list.virtual.getTotalSize()}>
      {list.virtual.getVirtualItems().map((item) => {
        const entry = list.ordered[item.index];
        const path = entry.selection.path;
        return (
          <div
            key={item.key}
            ref={list.virtual.measureElement}
            data-index={item.index}
            className="absolute top-row left-0 w-full"
            style={dynamic({ '--row-offset': `${item.start}px` })}
          >
            <FileDiff
              pane={list.pane}
              entry={entry}
              start={item.start}
              closed={Boolean(list.closed[path])}
              opening={list.openings[path]}
              found={list.located.get(path)}
              jump={list.jump?.path === path ? list.jump : undefined}
            />
          </div>
        );
      })}
    </VirtualCanvas>
  );
}
function StackBody({
  repo,
  stack,
  state,
  list,
}: {
  repo: string;
  stack: Stack;
  state: {
    sameComparison: boolean;
    error: Error | null;
    mergeBase: boolean;
    listing: boolean;
    empty: boolean;
    onRetryFiles: () => void;
  };
  list: StackListProps;
}) {
  if (stack === 'compare' && state.sameComparison) return <SameRefState />;
  if (state.error && stack === 'compare')
    return (
      <CompareError
        repo={repo}
        message={state.error.message}
        mergeBase={state.mergeBase}
      />
    );
  if (state.error)
    return (
      <ErrorState
        title="Could not list the changes"
        error={state.error}
        retry={state.onRetryFiles}
      />
    );
  if (state.listing)
    return (
      <State icon={Loader2} title="Loading changes">
        Reading the changed files.
      </State>
    );
  if (state.empty)
    return (
      <State icon={CheckCircle2} title="Nothing here">
        This group is empty.
      </State>
    );
  return <StackFileList list={list} />;
}
interface AllChangesPaneProps {
  repo: string;
  stack: Stack;
  commit?: Selection;
  status: Status;
  settings: Settings;
  disabled: boolean;
}
export const AllChangesPane = memo(function AllChangesPane(
  props: AllChangesPaneProps,
) {
  const { repo, stack, commit } = props;
  const controller = useAllChangesController({
    repo: repo,
    stack: stack,
    commit: commit,
    status: props.status,
    settings: props.settings,
    disabled: props.disabled,
  });
  const label =
    commit?.source === 'stash' ? 'All changes in stash' : labels[stack];
  return (
    <section className="flex h-full min-w-0 flex-col" aria-label={label}>
      <StackHeader
        stack={stack}
        commit={commit}
        listing={controller.listing}
        count={controller.count}
        compare={controller.compare}
      />
      {controller.find.open && (
        <FindBar
          find={controller.find}
          onClose={() =>
            controller.scroller.current?.focus({ preventScroll: true })
          }
        />
      )}
      <div
        ref={controller.scroller}
        tabIndex={-1}
        role="region"
        aria-label="Stacked diff content"
        onKeyDownCapture={scrollPage}
        className={`relative min-h-0 flex-1 overflow-y-auto ${focusInset}`}
      >
        <div>
          <StackBody
            repo={repo}
            stack={stack}
            state={controller.bodyState}
            list={controller.bodyList}
          />
        </div>
      </div>
    </section>
  );
});
