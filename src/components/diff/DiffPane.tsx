import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  ExternalLink,
  Eye,
  EyeOff,
  FileCog,
  History,
  Image,
  Pencil,
  Save,
  Trash2,
  SquareMinus,
  SquarePlus,
  UnfoldVertical,
  User,
  WrapText,
} from 'lucide-react';
import { useActions } from '../../lib/actions';
import { useBackend } from '../../lib/query';
import { splitPath } from '../../lib/paths';
import { useDiffView } from '../../stores/diff-view';
import { save, useDirty } from '../../stores/editor';
import { useLayout } from '../../stores/layout';
import { useSelection } from '../../stores/selection';
import type { Selection, Settings } from '../../lib/types';
import { Button } from '../shared/Button';
import type { VirtualListHandle } from '../shared/VirtualList';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { StatusBadge } from '../sidebar/StatusBadge';
import { ImageDiff } from '../image/ImageDiff';
import { BlameView } from './BlameView';
import { FindBar, findActions } from './FindBar';
import { rowOfSide, useFind } from './find';
import { FileIcon } from '../sidebar/FileIcon';
import { DiffSourcePill } from './DiffSourcePill';
import { DiffToolbar } from './DiffToolbar';
import { DiffSurface, type DiffSurfaceHandle } from './DiffSurface';
import { MarkdownView, isMarkdown } from './Markdown';
import {
  ChangeCountBadges,
  CopyPathButton,
  EditButton,
  OpenInSystemButton,
  openInSystem,
} from './DiffFileActions';
import { useDiffFile } from './useDiffFile';
import { canEdit } from './editable';
import { useExpansion } from './expansion';
import { DIFF_CONTEXT_LINES } from './rows';
import { cachedEntry } from './stack';
import { useTokens } from './tokens';
import { scopeKey } from '../../lib/git';
import { stepIndex } from '../../lib/list';
import { accentToggle, paneHeader } from '../shared/styles';
const FULL_FILE_CONTEXT_LINES = 50000;
const EditSurface = lazy(() => import('../editor/EditSurface'));
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
function SelectedDiff({
  repo,
  selection,
  settings,
  disabled,
}: {
  repo: string;
  selection: Selection;
  settings: Settings;
  disabled: boolean;
}) {
  const [overrideLimit, setOverride] = useState(false);
  const status = useBackend('status', { repo });
  const entry = status.data?.entries.find(
    (entry) => entry.path === selection.path,
  );
  const letter = selection.source === 'staged' ? entry?.index : entry?.worktree;
  const { directory, name } = splitPath(selection.path);
  const markdown = isMarkdown(selection.path);
  const rendered = markdown && Boolean(selection.rendered);
  const query = useBackend(
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
    !selection.blame,
    !overrideLimit && !rendered ? cachedEntry(repo, selection) : undefined,
  );
  const [wrap, setWrap] = useState(false);
  const toggleWrap = useCallback(() => setWrap((value) => !value), []);
  const [whitespace, setWhitespace] = useState(false);
  const [currentHunk, setCurrentHunk] = useState(0);
  const surface = useRef<DiffSurfaceHandle>(null);
  const data = query.data;
  const expansion = useExpansion(repo, selection, data);
  const { mode, split, rows, counts, hunkAction } = useDiffFile({
    repo: repo,
    selection: selection,
    data: data,
    reveal: expansion.reveal,
    defaultMode: settings.diffMode,
  });
  const editable = canEdit(selection.source, entry?.worktree, data);
  const editing = Boolean(selection.editing) && editable;
  const tokens = useTokens(repo, selection, data, !editing);
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
  const blameList = useRef<VirtualListHandle>(null);
  const find = useFind(texts, (index) =>
    selection.blame
      ? blameList.current?.scrollToIndex(index, 'center')
      : surface.current?.scrollToRow(rowOfSide(index), 'center'),
  );
  const dirty = useDirty(repo, selection.path);
  const preview = useMemo(() => {
    if (!data || !rendered) return { text: '', deleted: false };
    if (data.content !== null) return { text: data.content, deleted: false };
    const all = data.hunks.flatMap((hunk) => hunk.lines);
    const kept = all.filter((line) => line.kind !== 'remove');
    const deleted = all.length > 0 && kept.length === 0;
    return {
      text: (deleted ? all : kept).map((line) => line.content).join('\n'),
      deleted: deleted,
    };
  }, [data, rendered]);
  const toggleRendered = () =>
    useSelection.getState().select(repo, {
      ...selection,
      rendered: !selection.rendered,
      blame: false,
      editing: false,
    });
  const toggleBlame = () =>
    useSelection.getState().select(repo, {
      ...selection,
      blame: !selection.blame,
      rendered: false,
      editing: false,
    });
  const toggleEdit = () =>
    useSelection.getState().select(repo, {
      ...selection,
      editing: !editing,
      blame: false,
      rendered: false,
    });
  const move = (direction: number) => {
    const indices = rows.flatMap((row, index) =>
      row.hunk !== undefined ? [index] : [],
    );
    if (indices.length) {
      const next = stepIndex(currentHunk, direction, indices.length);
      setCurrentHunk(next);
      surface.current?.scrollToRow(indices[next]);
    }
  };
  const selectedHunk = Math.min(
    currentHunk,
    Math.max(0, (data?.hunks.length ?? 0) - 1),
  );
  const stageHunk = () =>
    hunkAction(
      selectedHunk,
      selection.source === 'staged' ? 'unstage' : 'stage',
    );
  useActions(scopeKey(repo, 'diff'), [
    ...(editing ? [] : findActions(find, rendered)),
    {
      id: 'next-hunk',
      icon: <ChevronDown className="size-3.5" />,
      label: 'Next change',
      key: 'Alt+ArrowDown',
      run: () => move(1),
      disabled: !data?.hunks.length,
    },
    {
      id: 'previous-hunk',
      icon: <ChevronUp className="size-3.5" />,
      label: 'Previous change',
      key: 'Alt+ArrowUp',
      run: () => move(-1),
      disabled: !data?.hunks.length,
    },
    {
      id: 'stage-hunk',
      icon:
        selection.source === 'staged' ? (
          <SquareMinus className="size-3.5" />
        ) : (
          <SquarePlus className="size-3.5" />
        ),
      label: selection.source === 'staged' ? 'Unstage hunk' : 'Stage hunk',
      key: 'Mod+Alt+s',
      run: stageHunk,
      disabled:
        disabled ||
        !data?.hunks.length ||
        !['staged', 'unstaged'].includes(selection.source),
    },
    {
      id: 'discard-hunk',
      icon: <Trash2 className="size-3.5" />,
      label: 'Discard hunk',
      key: 'Mod+Alt+d',
      run: () => hunkAction(selectedHunk, 'discard'),
      disabled:
        disabled || !data?.hunks.length || selection.source !== 'unstaged',
    },
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
      run: () => save(repo, selection.path),
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
      run: () => setWhitespace((value) => !value),
    },
    {
      id: 'context',
      icon: <UnfoldVertical className="size-3.5" />,
      label: 'Show or hide full file',
      key: 'Mod+Alt+c',
      run: expansion.toggleFull,
      disabled: !expansion.available,
    },
    {
      id: 'diff-mode',
      icon: <Columns2 className="size-3.5" />,
      label: 'Toggle split and unified diff',
      key: 'Mod+Alt+v',
      run: () =>
        useDiffView.getState().setMode(mode === 'split' ? 'unified' : 'split'),
    },
  ]);
  return (
    <section className="flex h-full min-w-0 flex-col" aria-label="Diff viewer">
      <header className={paneHeader}>
        <span className="mr-1 flex">
          <FileIcon name={name} directory={false} />
        </span>
        <span className="truncate text-sm" title={selection.path}>
          <span className="text-muted dark:text-muted-dark">{directory}</span>
          <span className="font-semibold">{name}</span>
        </span>
        {dirty && (
          <span
            role="img"
            aria-label="Unsaved changes"
            className="size-status-dot shrink-0 rounded-full bg-accent dark:bg-accent-dark"
          />
        )}
        <CopyPathButton path={selection.path} />
        <DiffSourcePill selection={selection} />
        <ChangeCountBadges counts={counts} />
        <div className="ml-auto flex items-center gap-1">
          <OpenInSystemButton repo={repo} path={selection.path} />
          <Button
            title="File history"
            onClick={() => openFileHistory(repo, selection.path)}
          >
            <History className="size-4" />
            <span>History</span>
          </Button>
          {markdown && (
            <Button
              title={
                rendered ? 'Show the source diff' : 'Show rendered Markdown'
              }
              disabled={data?.tooLarge === true}
              onClick={toggleRendered}
            >
              <Eye className="size-4" />
              <span className="min-w-16">
                {rendered ? 'Source' : 'Rendered'}
              </span>
            </Button>
          )}
          <Button onClick={toggleBlame}>
            <User className="size-4" />
            <span className="min-w-10.5">
              {selection.blame ? 'Diff' : 'Blame'}
            </span>
          </Button>
          {editable ? (
            <EditButton
              aria-pressed={editing}
              className={editing ? accentToggle : ''}
              onClick={toggleEdit}
              label={editing ? 'Diff' : 'Edit'}
              labelClassName="min-w-7"
            />
          ) : (
            <EditButton
              aria-hidden
              tabIndex={-1}
              disabled
              className="invisible"
              label="Edit"
              labelClassName="min-w-7"
            />
          )}
        </div>
        <span className="flex w-3.5 shrink-0">
          {letter && <StatusBadge status={letter} />}
        </span>
      </header>
      {find.open && !editing && !rendered && (
        <FindBar find={find} onClose={() => surface.current?.focus()} />
      )}
      {selection.blame ? (
        <BlameView
          repo={repo}
          selection={selection}
          list={blameList}
          found={find.found}
        />
      ) : query.error ? (
        <ErrorState
          title="Could not load this file"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !data ? (
        <State title="Loading file…" />
      ) : editing ? (
        <Suspense fallback={<State title="Loading editor…" />}>
          <EditSurface
            repo={repo}
            path={selection.path}
            wrap={wrap}
            toggleWrap={toggleWrap}
          />
        </Suspense>
      ) : data.tooLarge ? (
        <State
          icon={Image}
          title="File too large to diff"
          action={
            data.image ? (
              <Button onClick={() => void openInSystem(repo, selection.path)}>
                Open in system application
              </Button>
            ) : (
              <Button onClick={() => setOverride(true)}>View anyway</Button>
            )
          }
        >
          This file is {Math.max(data.oldSize, data.newSize).toLocaleString()}{' '}
          bytes. The default limit is{' '}
          {data.image ? '20 MB' : '2 MB or 50,000 diff lines'}.
        </State>
      ) : data.image ? (
        <ImageDiff
          repo={repo}
          selection={selection}
          diff={data}
          version={query.dataUpdatedAt}
        />
      ) : data.binary ? (
        <State icon={Image} title="Binary file">
          Open this file in its system application to inspect it.
        </State>
      ) : data.content === null && data.hunks.length === 0 ? (
        <State icon={FileCog} title="No content change">
          {data.oldMode !== data.newMode
            ? `Permissions changed from ${data.oldMode ?? 'absent'} to ${data.newMode ?? 'absent'}.`
            : 'Line endings or file metadata changed; there is no textual difference.'}
        </State>
      ) : rendered ? (
        <MarkdownView markdown={preview.text} deleted={preview.deleted} />
      ) : (
        <>
          <DiffToolbar
            mode={mode}
            wrap={wrap}
            whitespace={whitespace}
            full={expansion.available ? expansion.full : undefined}
            toggleWrap={toggleWrap}
            toggleWhitespace={() => setWhitespace(!whitespace)}
            toggleFull={expansion.toggleFull}
            move={move}
          />
          <DiffSurface
            ref={surface}
            rows={rows}
            hunks={data.hunks}
            patches={data.patches}
            split={split}
            wrap={wrap}
            whitespace={whitespace}
            tokens={tokens}
            source={selection.source}
            disabled={disabled}
            hunkAction={(hunk, action) => void hunkAction(hunk, action)}
            expansion={expansion}
            found={find.found}
          />
        </>
      )}
    </section>
  );
}
function openFileHistory(repo: string, path: string) {
  useLayout.getState().update(repo, { mode: 'history' });
  useSelection.getState().setPath(repo, path);
}
