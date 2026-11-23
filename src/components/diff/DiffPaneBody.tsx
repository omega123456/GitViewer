import { lazy, Suspense, type RefObject } from 'react';
import { FileCog, Image } from 'lucide-react';
import type { Diff, Selection, Settings } from '../../lib/types';
import { Button } from '../shared/Button';
import type { VirtualListHandle } from '../shared/VirtualList';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { ImageDiff } from '../image/ImageDiff';
import { BlameView } from './BlameView';
import { openInSystem } from './DiffFileActions';
import { DiffSurface, type DiffSurfaceHandle } from './DiffSurface';
import { DiffToolbar } from './DiffToolbar';
import { MarkdownView } from './Markdown';
import type { Expansion } from './expansion';
import type { Found } from './find';
import type { Row } from './rows';
import type { Tokens } from './tokens';
const EditSurface = lazy(() => import('../editor/EditSurface'));
export interface DiffPaneBodyProps {
  repo: string;
  selection: Selection;
  disabled: boolean;
  query: {
    data: Diff | undefined;
    error: Error | null;
    dataUpdatedAt: number;
    refetch: () => Promise<unknown>;
  };
  view: {
    mode: Settings['diffMode'];
    split: boolean;
    wrap: boolean;
    whitespace: boolean;
    editing: boolean;
    rendered: boolean;
    preview: { text: string; deleted: boolean };
  };
  content: {
    rows: Row[];
    tokens: Tokens;
    expansion: Expansion;
    found: Found | undefined;
    surface: RefObject<DiffSurfaceHandle | null>;
    blameList: RefObject<VirtualListHandle | null>;
  };
  actions: {
    onOverrideLimit: () => void;
    onToggleWrap: () => void;
    onToggleWhitespace: () => void;
    onMoveHunk: (direction: number) => void;
    onHunkAction: (hunk: number, action: string) => void;
  };
}
function TooLargeState({
  repo,
  path,
  data,
  onOverrideLimit,
}: {
  repo: string;
  path: string;
  data: Diff;
  onOverrideLimit: () => void;
}) {
  const bytes = Math.max(data.oldSize, data.newSize).toLocaleString();
  const limitLabel = data.image ? '20 MB' : '2 MB or 50,000 diff lines';
  const action = data.image ? (
    <Button onClick={() => void openInSystem(repo, path)}>
      Open in system application
    </Button>
  ) : (
    <Button onClick={onOverrideLimit}>View anyway</Button>
  );
  return (
    <State icon={Image} title="File too large to diff" action={action}>
      This file is {bytes} bytes. The default limit is {limitLabel}.
    </State>
  );
}
function NoContentChangeState({ data }: { data: Diff }) {
  const modeChanged = data.oldMode !== data.newMode;
  const details = modeChanged
    ? `Permissions changed from ${data.oldMode ?? 'absent'} to ${data.newMode ?? 'absent'}.`
    : 'Line endings or file metadata changed; there is no textual difference.';
  return (
    <State icon={FileCog} title="No content change">
      {details}
    </State>
  );
}
function TextDiffView(props: DiffPaneBodyProps & { data: Diff }) {
  const { selection, disabled, view, content, actions, data } = props;
  return (
    <>
      <DiffToolbar
        mode={view.mode}
        wrap={view.wrap}
        whitespace={view.whitespace}
        full={content.expansion.available ? content.expansion.full : undefined}
        toggleWrap={actions.onToggleWrap}
        toggleWhitespace={actions.onToggleWhitespace}
        toggleFull={content.expansion.toggleFull}
        move={actions.onMoveHunk}
      />
      <DiffSurface
        ref={content.surface}
        rows={content.rows}
        diff={data}
        display={{
          split: view.split,
          wrap: view.wrap,
          whitespace: view.whitespace,
        }}
        tokens={content.tokens}
        controls={{
          source: selection.source,
          disabled: disabled,
          act: actions.onHunkAction,
        }}
        expansion={content.expansion}
        found={content.found}
      />
    </>
  );
}
function LoadedFileBody(props: DiffPaneBodyProps & { data: Diff }) {
  const { repo, selection, query, view, actions, data } = props;
  if (view.editing)
    return (
      <Suspense fallback={<State title="Loading editor…" />}>
        <EditSurface
          repo={repo}
          path={selection.path}
          wrap={view.wrap}
          toggleWrap={actions.onToggleWrap}
        />
      </Suspense>
    );
  if (data.tooLarge)
    return (
      <TooLargeState
        repo={repo}
        path={selection.path}
        data={data}
        onOverrideLimit={actions.onOverrideLimit}
      />
    );
  if (data.image)
    return (
      <ImageDiff
        repo={repo}
        selection={selection}
        diff={data}
        version={query.dataUpdatedAt}
      />
    );
  if (data.binary)
    return (
      <State icon={Image} title="Binary file">
        Open this file in its system application to inspect it.
      </State>
    );
  const unchangedText = data.content === null && data.hunks.length === 0;
  if (unchangedText) return <NoContentChangeState data={data} />;
  if (view.rendered)
    return (
      <MarkdownView
        markdown={view.preview.text}
        deleted={view.preview.deleted}
      />
    );
  return <TextDiffView {...props} />;
}
export function DiffPaneBody(props: DiffPaneBodyProps) {
  const { repo, selection, query, content } = props;
  if (selection.blame)
    return (
      <BlameView
        repo={repo}
        selection={selection}
        list={content.blameList}
        found={content.found}
      />
    );
  if (query.error)
    return (
      <ErrorState
        title="Could not load this file"
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  if (!query.data) return <State title="Loading file…" />;
  return <LoadedFileBody {...props} data={query.data} />;
}
