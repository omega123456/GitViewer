import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useActions } from '../../lib/actions';
import { useBackend, useSeededBackend } from '../../lib/query';
import { useDirty } from '../../stores/editor';
import { useOpenFile } from '../../lib/open-file';
import type { Diff, Selection, Settings } from '../../lib/types';
import type { VirtualListHandle } from '../shared/VirtualList';
import { State } from '../states/State';
import { FindBar } from './FindBar';
import { rowOfSide, useFind } from './find';
import type { DiffSurfaceHandle } from './DiffSurface';
import { isMarkdown } from './Markdown';
import { useDiffFile } from './useDiffFile';
import { canEdit } from './editable';
import { useExpansion } from './expansion';
import { DIFF_CONTEXT_LINES, type Row } from './rows';
import { cachedEntry } from './stack';
import { useTokens } from './tokens';
import { withViewMode, type ViewMode } from './view-mode';
import { scopeKey } from '../../lib/git';
import { stepIndex } from '../../lib/list';
import { DiffPaneBody } from './DiffPaneBody';
import { DiffPaneHeader } from './DiffPaneHeader';
import { diffPaneActions, markdownPreview } from './diff-actions';
const FULL_FILE_CONTEXT_LINES = 50000;
export const DiffPane = memo(function DiffPane({
  repo,
  selection,
  settings,
  disabled,
}: {
  repo: string;
  selection?: Selection;
  settings: Settings;
  disabled: boolean;
}) {
  if (!selection)
    return (
      <State title="Select a file to review">
        Browse every file, review your changes, and build a commit.
      </State>
    );
  return (
    <SelectedDiff
      key={`${selection.source}:${selection.revision}:${selection.path}:${selection.blame}`}
      repo={repo}
      selection={selection}
      settings={settings}
      disabled={disabled}
    />
  );
});
function useDiffQuery(
  repo: string,
  selection: Selection,
  options: { rendered: boolean; overrideLimit: boolean },
) {
  const { rendered, overrideLimit } = options;
  const seeded = !overrideLimit && !rendered;
  return useSeededBackend(
    'diff',
    {
      repo: repo,
      path: selection.path,
      source: selection.source,
      revision: selection.revision,
      base: selection.base,
      context: rendered ? FULL_FILE_CONTEXT_LINES : DIFF_CONTEXT_LINES,
      overrideLimit: overrideLimit,
    },
    {
      enabled: !selection.blame,
      initial: seeded ? cachedEntry(repo, selection) : undefined,
    },
  );
}
function useDiffSearch({
  repo,
  selection,
  rows,
  surface,
  blameList,
}: {
  repo: string;
  selection: Selection;
  rows: Row[];
  surface: React.RefObject<DiffSurfaceHandle | null>;
  blameList: React.RefObject<VirtualListHandle | null>;
}) {
  const blame = useBackend(
    'blame',
    { repo: repo, path: selection.path },
    Boolean(selection.blame),
  );
  const texts = useCallback(
    () =>
      selection.blame
        ? (blame.data ?? []).map((line) => line.content)
        : rows.flatMap((row) => [
            row.left?.content ?? '',
            row.right?.content ?? '',
          ]),
    [selection.blame, blame.data, rows],
  );
  return useFind(texts, (index) =>
    selection.blame
      ? blameList.current?.scrollToIndex(index, 'center')
      : surface.current?.scrollToRow(rowOfSide(index), 'center'),
  );
}
function useHunkNavigation(
  rows: Row[],
  data: Diff | undefined,
  surface: React.RefObject<DiffSurfaceHandle | null>,
) {
  const [currentHunk, setCurrentHunk] = useState(0);
  const move = (direction: number) => {
    const indices = rows.flatMap((row, index) =>
      row.hunk !== undefined ? [index] : [],
    );
    if (!indices.length) return;
    const next = stepIndex(currentHunk, direction, indices.length);
    setCurrentHunk(next);
    surface.current?.scrollToRow(indices[next]);
  };
  const selectedHunk = Math.min(
    currentHunk,
    Math.max(0, (data?.hunks.length ?? 0) - 1),
  );
  return { selectedHunk, move };
}
function useSelectedFileStatus(repo: string, selection: Selection) {
  const status = useBackend('status', { repo });
  const entry = status.data?.entries.find(
    (item) => item.path === selection.path,
  );
  const letter = selection.source === 'staged' ? entry?.index : entry?.worktree;
  return { entry, letter };
}
function useViewToggles(repo: string, selection: Selection, editing: boolean) {
  const openFile = useOpenFile(repo);
  const toggle = (mode: ViewMode, enabled: boolean) =>
    openFile(withViewMode(selection, mode, enabled));
  return {
    toggleRendered: () => toggle('rendered', !selection.rendered),
    toggleBlame: () => toggle('blame', !selection.blame),
    toggleEdit: () => toggle('editing', !editing),
  };
}
function useSelectedDiffResources({
  repo,
  selection,
  settings,
  overrideLimit,
}: {
  repo: string;
  selection: Selection;
  settings: Settings;
  overrideLimit: boolean;
}) {
  const { entry, letter } = useSelectedFileStatus(repo, selection);
  const markdown = isMarkdown(selection.path);
  const rendered = markdown && Boolean(selection.rendered);
  const query = useDiffQuery(repo, selection, { rendered, overrideLimit });
  const data = query.data;
  const target = { repo: repo, selection: selection, data: data };
  const expansion = useExpansion(target);
  const diffFile = useDiffFile({
    repo: repo,
    selection: selection,
    data: data,
    reveal: expansion.reveal,
    defaultMode: settings.diffMode,
  });
  const editable = canEdit(selection.source, entry?.worktree, data);
  const editing = Boolean(selection.editing) && editable;
  const tokens = useTokens(target, !editing);
  const dirty = useDirty({ repo: repo, path: selection.path });
  const preview = useMemo(
    () => markdownPreview(data, rendered),
    [data, rendered],
  );
  return {
    letter,
    markdown,
    rendered,
    query,
    data,
    expansion,
    diffFile,
    editable,
    editing,
    tokens,
    dirty,
    preview,
  };
}
type SelectedDiffResources = ReturnType<typeof useSelectedDiffResources>;
interface SelectedDiffProps {
  repo: string;
  selection: Selection;
  settings: Settings;
  disabled: boolean;
}
function registerDiffActions({
  repo,
  selection,
  disabled,
  resources,
  find,
  navigation,
  controls,
}: {
  repo: string;
  selection: Selection;
  disabled: boolean;
  resources: SelectedDiffResources;
  find: ReturnType<typeof useDiffSearch>;
  navigation: ReturnType<typeof useHunkNavigation>;
  controls: {
    toggles: ReturnType<typeof useViewToggles>;
    toggleWrap: () => void;
    toggleWhitespace: () => void;
  };
}) {
  const stageAction = selection.source === 'staged' ? 'unstage' : 'stage';
  return diffPaneActions({
    repo: repo,
    selection: selection,
    data: resources.data,
    disabled: disabled,
    mode: resources.diffFile.mode,
    editing: resources.editing,
    editable: resources.editable,
    dirty: resources.dirty,
    markdown: resources.markdown,
    rendered: resources.rendered,
    expansionAvailable: resources.expansion.available,
    find: find,
    move: navigation.move,
    stageHunk: () =>
      resources.diffFile.hunkAction(navigation.selectedHunk, stageAction),
    discardHunk: () =>
      resources.diffFile.hunkAction(navigation.selectedHunk, 'discard'),
    toggleEdit: controls.toggles.toggleEdit,
    toggleBlame: controls.toggles.toggleBlame,
    toggleRendered: controls.toggles.toggleRendered,
    toggleWrap: controls.toggleWrap,
    toggleWhitespace: controls.toggleWhitespace,
    toggleFull: resources.expansion.toggleFull,
  });
}
function useSelectedDiffState(props: SelectedDiffProps) {
  const { repo, selection, settings, disabled } = props;
  const [overrideLimit, setOverride] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [whitespace, setWhitespace] = useState(false);
  const toggleWrap = useCallback(() => setWrap((value) => !value), []);
  const toggleWhitespace = () => setWhitespace((value) => !value);
  const resources = useSelectedDiffResources({
    repo,
    selection,
    settings,
    overrideLimit,
  });
  const surface = useRef<DiffSurfaceHandle>(null);
  const blameList = useRef<VirtualListHandle>(null);
  const find = useDiffSearch({
    repo: repo,
    selection: selection,
    rows: resources.diffFile.rows,
    surface: surface,
    blameList: blameList,
  });
  const navigation = useHunkNavigation(
    resources.diffFile.rows,
    resources.data,
    surface,
  );
  const toggles = useViewToggles(repo, selection, resources.editing);
  const actions = registerDiffActions({
    repo: repo,
    selection: selection,
    disabled: disabled,
    resources: resources,
    find: find,
    navigation: navigation,
    controls: { toggles, toggleWrap, toggleWhitespace },
  });
  useActions(scopeKey(repo, 'diff'), actions);
  return {
    resources: resources,
    find: find,
    surface: surface,
    blameList: blameList,
    wrap: wrap,
    whitespace: whitespace,
    toggles: toggles,
    toggleWrap: toggleWrap,
    toggleWhitespace: toggleWhitespace,
    move: navigation.move,
    override: () => setOverride(true),
  };
}
type SelectedDiffState = ReturnType<typeof useSelectedDiffState>;
function buildPaneProps(state: SelectedDiffState) {
  const { resources, toggles } = state;
  return {
    header: {
      dirty: resources.dirty,
      counts: resources.diffFile.counts,
      letter: resources.letter,
      markdown: resources.markdown,
      rendered: resources.rendered,
      tooLarge: resources.data?.tooLarge === true,
      editable: resources.editable,
      editing: resources.editing,
      onToggleRendered: toggles.toggleRendered,
      onToggleBlame: toggles.toggleBlame,
      onToggleEdit: toggles.toggleEdit,
    },
    view: {
      mode: resources.diffFile.mode,
      split: resources.diffFile.split,
      wrap: state.wrap,
      whitespace: state.whitespace,
      editing: resources.editing,
      rendered: resources.rendered,
      preview: resources.preview,
    },
    content: {
      rows: resources.diffFile.rows,
      tokens: resources.tokens,
      expansion: resources.expansion,
      found: state.find.found,
      surface: state.surface,
      blameList: state.blameList,
    },
    actions: {
      onOverrideLimit: state.override,
      onToggleWrap: state.toggleWrap,
      onToggleWhitespace: state.toggleWhitespace,
      onMoveHunk: state.move,
      onHunkAction: (hunk: number, action: string) =>
        void resources.diffFile.hunkAction(hunk, action),
    },
  };
}
function SelectedDiff(props: SelectedDiffProps) {
  const { repo, selection, disabled } = props;
  const state = useSelectedDiffState(props);
  const pane = buildPaneProps(state);
  const showFindBar =
    state.find.open && !pane.view.editing && !pane.view.rendered;
  return (
    <section className="flex h-full min-w-0 flex-col" aria-label="Diff viewer">
      <DiffPaneHeader repo={repo} selection={selection} state={pane.header} />
      {showFindBar && (
        <FindBar
          find={state.find}
          onClose={() => state.surface.current?.focus()}
        />
      )}
      <DiffPaneBody
        repo={repo}
        selection={selection}
        disabled={disabled}
        query={state.resources.query}
        view={pane.view}
        content={pane.content}
        actions={pane.actions}
      />
    </section>
  );
}
