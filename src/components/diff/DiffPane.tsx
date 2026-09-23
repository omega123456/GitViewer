import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileCog,
  History,
  Image,
  Trash2,
  SquareMinus,
  SquarePlus,
  UnfoldVertical,
  User,
  WrapText,
} from 'lucide-react';
import { useActions } from '../../lib/actions';
import { useBackend, perform } from '../../lib/query';
import { useDiffView } from '../../stores/diff-view';
import { useLayout } from '../../stores/layout';
import { useSelection } from '../../stores/selection';
import type { Selection, Settings } from '../../lib/types';
import { Button } from '../shared/Button';
import { CopyButton } from '../shared/CopyButton';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { StatusBadge } from '../sidebar/StatusBadge';
import { ImageDiff } from '../image/ImageDiff';
import { BlameView } from './BlameView';
import { DiffSourcePill } from './DiffSourcePill';
import { DiffToolbar } from './DiffToolbar';
import { DiffSurface, type DiffSurfaceHandle } from './DiffSurface';
import { MarkdownView, isMarkdown } from './Markdown';
import { runHunkAction } from './hunks';
import { diffRows } from './rows';
import { cachedEntry } from './stack';
import { useTokens } from './tokens';
export function DiffPane({
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
}
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
  const [context, setContext] = useState(3);
  const [overrideLimit, setOverride] = useState(false);
  const status = useBackend('status', { repo });
  const entry = status.data?.entries.find(
    (entry) => entry.path === selection.path,
  );
  const letter = selection.source === 'staged' ? entry?.index : entry?.worktree;
  const cut = selection.path.lastIndexOf('/') + 1;
  const directory = selection.path.slice(0, cut);
  const name = selection.path.slice(cut);
  const markdown = isMarkdown(selection.path);
  const rendered = markdown && Boolean(selection.rendered);
  const query = useBackend(
    'diff',
    { repo, ...selection, context: rendered ? 50000 : context, overrideLimit },
    !selection.blame,
    context === 3 && !overrideLimit && !rendered
      ? cachedEntry(repo, selection)
      : undefined,
  );
  const mode = useDiffView((s) => s.mode) ?? settings.diffMode;
  const [wrap, setWrap] = useState(false);
  const [whitespace, setWhitespace] = useState(false);
  const [currentHunk, setCurrentHunk] = useState(0);
  const surface = useRef<DiffSurfaceHandle>(null);
  const data = query.data;
  const split = mode === 'split' && data?.content === null;
  const rows = useMemo(
    () => (data ? diffRows(data, split) : []),
    [data, split],
  );
  const lines = data?.hunks.flatMap((hunk) => hunk.lines) ?? [];
  const added = lines.filter((line) => line.kind === 'add').length;
  const removed = lines.filter((line) => line.kind === 'remove').length;
  const tokens = useTokens(data, selection.path);
  const preview = useMemo(() => {
    if (!data) return { text: '', deleted: false };
    if (data.content !== null) return { text: data.content, deleted: false };
    const all = data.hunks.flatMap((hunk) => hunk.lines);
    const kept = all.filter((line) => line.kind !== 'remove');
    const deleted = all.length > 0 && kept.length === 0;
    return {
      text: (deleted ? all : kept).map((line) => line.content).join('\n'),
      deleted,
    };
  }, [data]);
  const toggleRendered = () =>
    useSelection.getState().select(repo, {
      ...selection,
      rendered: !selection.rendered,
      blame: false,
    });
  const toggleBlame = () =>
    useSelection.getState().select(repo, {
      ...selection,
      blame: !selection.blame,
      rendered: false,
    });
  const move = (direction: number) => {
    const indices = rows.flatMap((row, index) =>
      row.hunk !== undefined ? [index] : [],
    );
    if (indices.length) {
      const next = (currentHunk + direction + indices.length) % indices.length;
      setCurrentHunk(next);
      surface.current?.scrollToRow(indices[next]);
    }
  };
  const hunkAction = (hunk: number, action: string) =>
    runHunkAction(repo, selection, data!, context, hunk, action);
  const selectedHunk = Math.min(
    currentHunk,
    Math.max(0, (data?.hunks.length ?? 0) - 1),
  );
  const stageHunk = () =>
    hunkAction(
      selectedHunk,
      selection.source === 'staged' ? 'unstage' : 'stage',
    );
  const toggleContext = () => setContext((value) => (value === 3 ? 30 : 3));
  useActions(`${repo}:diff`, [
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
      id: 'open-file',
      icon: <ExternalLink className="size-3.5" />,
      label: 'Open in system application',
      key: 'Mod+e',
      run: () => perform('system_open', { repo, path: selection.path }),
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
      run: () => setWrap((value) => !value),
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
      label: 'Expand or collapse diff context',
      key: 'Mod+Alt+c',
      run: toggleContext,
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
      <header className="flex h-tab shrink-0 items-center gap-2 border-b border-line px-3 dark:border-line-dark">
        <File className="size-4 shrink-0 text-faint dark:text-faint-dark" />
        <span className="truncate text-sm" title={selection.path}>
          <span className="text-muted">{directory}</span>
          <span className="font-semibold">{name}</span>
        </span>
        <CopyButton
          text={selection.path}
          label="Copy file path"
          className="size-6 text-muted dark:text-muted-dark"
        />
        <DiffSourcePill selection={selection} />
        {Boolean(added) && (
          <span className="shrink-0 font-mono text-label text-added dark:text-added-dark">
            +{added}
          </span>
        )}
        {Boolean(removed) && (
          <span className="shrink-0 font-mono text-label text-deleted dark:text-deleted-dark">
            −{removed}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            title="Open in system application"
            onClick={() =>
              void perform('system_open', { repo, path: selection.path })
            }
          >
            <ExternalLink className="size-4" />
            <span>Open</span>
          </Button>
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
              <span className="min-w-14">
                {rendered ? 'Source' : 'Rendered'}
              </span>
            </Button>
          )}
          <Button onClick={toggleBlame}>
            <User className="size-4" />
            <span className="min-w-9">
              {selection.blame ? 'Diff' : 'Blame'}
            </span>
          </Button>
        </div>
        <span className="flex w-3.5 shrink-0">
          {letter && <StatusBadge status={letter} />}
        </span>
      </header>
      {selection.blame ? (
        <BlameView repo={repo} selection={selection} />
      ) : query.error ? (
        <ErrorState
          title="Could not load this file"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !data ? (
        <State title="Loading file…" />
      ) : data.tooLarge ? (
        <State
          icon={Image}
          title="File too large to diff"
          action={
            data.image ? (
              <Button
                onClick={() =>
                  void perform('system_open', { repo, path: selection.path })
                }
              >
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
            context={context}
            setContext={setContext}
            toggleWrap={() => setWrap(!wrap)}
            toggleWhitespace={() => setWhitespace(!whitespace)}
            toggleContext={toggleContext}
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
