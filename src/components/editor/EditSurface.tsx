import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FileWarning,
  Replace,
  RotateCcw,
  Search,
  WrapText,
} from 'lucide-react';
import { isolateHistory } from '@codemirror/commands';
import { findNext, findPrevious, searchPanelOpen } from '@codemirror/search';
import type { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useActions } from '../../lib/actions';
import { fileName } from '../../lib/paths';
import { useBackend } from '../../lib/query';
import type { Opened } from '../../lib/types';
import {
  applyReconciliation,
  approveDiscard,
  current,
  drop,
  keepEdits,
  openBuffer,
  reconcile,
  reload,
  remember,
  save,
  track,
  useBuffer,
  type Buffer,
  type FileKey,
} from '../../stores/editor';
import { useStopEditing } from '../../lib/open-file';
import { useDark } from '../../lib/theme';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import {
  baseSlot,
  baseText,
  chrome,
  createState,
  describeLanguage,
  languageSlot,
  openFind,
  themeSlot,
  wrapping,
  wrapSlot,
} from './setup';
import { FindPanel } from './FindPanel';
import { scopeKey } from '../../lib/git';
import { findActionSet } from '../diff/FindControls';
import { accentToggle } from '../shared/styles';
const outline =
  'border border-line bg-surface text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';
export default function EditSurface({
  repo,
  path,
  wrap,
  toggleWrap,
}: {
  repo: string;
  path: string;
  wrap: boolean;
  toggleWrap: () => void;
}) {
  const opened = useBackend('file_read', { repo, path });
  const base = useBackend('file_lines', {
    repo: repo,
    path: path,
    source: 'staged',
  });
  const file = useMemo(() => ({ repo: repo, path: path }), [repo, path]);
  const ready = useBuffer(file);
  const dark = useDark();
  const stopEditing = useStopEditing(repo);
  const seen = useRef(opened.data);
  useEffect(() => {
    const data = opened.data;
    if (!opened.isSuccess || !data || ready || base.isPending) return;
    seen.current = data;
    openBuffer(
      file,
      data,
      createState({
        text: data.text,
        base: base.data,
        dark: dark,
        leave: stopEditing,
      }),
    );
  }, [
    opened.isSuccess,
    opened.data,
    ready,
    base.isPending,
    base.data,
    dark,
    file,
    stopEditing,
  ]);
  useEffect(() => {
    if (!opened.isSuccess || !ready || ready.saving || ready.conflict) return;
    const data = opened.data;
    if (data === seen.current) return;
    seen.current = data;
    applyReconciliation(file, reconcile(ready, data ?? null));
  }, [opened.isSuccess, opened.data, ready, file]);
  if (opened.error)
    return (
      <ErrorState
        title="Could not open this file"
        error={opened.error}
        retry={() => void opened.refetch()}
      />
    );
  if (opened.isSuccess && opened.data === null && !ready)
    return (
      <State icon={FileWarning} title="This file can't be edited here">
        GitViewer edits UTF-8 text files up to 2 MB.
      </State>
    );
  if (!ready) return <State title="Loading file…" />;
  return (
    <Editor
      file={file}
      buffer={ready}
      base={base.data}
      dark={dark}
      wrap={wrap}
      toggleWrap={toggleWrap}
    />
  );
}
function Editor({
  file,
  buffer,
  base,
  dark,
  wrap,
  toggleWrap,
}: {
  file: FileKey;
  buffer: Buffer;
  base: string | null | undefined;
  dark: boolean;
  wrap: boolean;
  toggleWrap: () => void;
}) {
  const { repo, path } = file;
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView>();
  const [language, setLanguage] = useState(
    () => describeLanguage(path)?.name ?? 'Plain text',
  );
  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const latest = current(file);
    const created = new EditorView({
      state: latest?.state,
      parent: parent,
      dispatchTransactions: (transactions: readonly Transaction[], target) => {
        target.update(transactions);
        track(file, target.state);
      },
    });
    const scroll = latest?.memory?.scroll;
    if (scroll)
      created.requestMeasure({
        read: () => null,
        write: () => {
          created.scrollDOM.scrollTop = scroll;
        },
      });
    if (latest?.memory?.focused) created.focus();
    setView(created);
    return () => {
      remember(file, {
        scroll: created.scrollDOM.scrollTop,
        focused: created.hasFocus,
      });
      created.destroy();
    };
  }, [file]);
  useEffect(() => {
    if (view && view.state !== buffer.state) view.setState(buffer.state);
  }, [view, buffer.state]);
  useEffect(() => {
    view?.dispatch({ effects: themeSlot.reconfigure(chrome(dark)) });
  }, [view, dark]);
  useEffect(() => {
    view?.dispatch({ effects: baseSlot.reconfigure(baseText(base)) });
  }, [view, base]);
  useEffect(() => {
    view?.dispatch({
      effects: wrapSlot.reconfigure(wrapping(wrap, toggleWrap)),
    });
  }, [view, wrap, toggleWrap]);
  useEffect(() => {
    const description = describeLanguage(path);
    if (!view || !description) return;
    let cancelled = false;
    void description.load().then((support) => {
      if (cancelled) return;
      view.dispatch({ effects: languageSlot.reconfigure(support) });
      setLanguage(description.name);
    });
    return () => {
      cancelled = true;
    };
  }, [view, path]);
  const finding = searchPanelOpen(buffer.state);
  const findActions = findActionSet({
    reveal: () => {
      if (view) openFind(view, false);
    },
    next: () => {
      if (view) findNext(view);
    },
    previous: () => {
      if (view) findPrevious(view);
    },
    revealDisabled: !view,
    stepDisabled: !view || !finding,
  });
  useActions(scopeKey(repo, 'editor'), [
    findActions.find,
    {
      id: 'replace',
      icon: <Replace className="size-3.5" />,
      label: 'Replace in file',
      key: 'Mod+Shift+r',
      run: () => view && openFind(view, true),
      disabled: !view,
    },
    findActions.next,
    findActions.previous,
  ]);
  const head = buffer.state.selection.main.head;
  const line = buffer.state.doc.lineAt(head);
  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-sub px-2 dark:border-line-dark dark:bg-sub-dark">
        <span className="flex gap-2.5 text-meta text-muted dark:text-muted-dark">
          <span>{language}</span>
          <span>{buffer.disk.bom ? 'UTF-8 with BOM' : 'UTF-8'}</span>
          <span>{buffer.disk.crlf ? 'CRLF' : 'LF'}</span>
          <span className="tabular-nums">
            Ln {line.number}, Col {head - line.from + 1}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Button
            title="Word wrap"
            aria-pressed={wrap}
            variant="icon"
            className={`size-control ${
              wrap ? accentToggle : 'text-muted dark:text-muted-dark'
            }`}
            onClick={toggleWrap}
          >
            <WrapText className="size-3.5" />
          </Button>
          <Button
            className="text-muted dark:text-muted-dark"
            disabled={!view}
            onClick={() => view && openFind(view, false)}
          >
            <Search className="size-4" />
            <span>Find</span>
          </Button>
          <Button
            className="text-muted dark:text-muted-dark"
            disabled={!view || !buffer.dirty || buffer.saving}
            onClick={async () => {
              if (!view || !(await approveDiscard(file))) return;
              view.dispatch({
                changes: {
                  from: 0,
                  to: view.state.doc.length,
                  insert: buffer.disk.saved,
                },
                annotations: isolateHistory.of('full'),
              });
            }}
          >
            <RotateCcw className="size-4" />
            <span>Revert</span>
          </Button>
          {buffer.saving ? (
            <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted dark:text-muted-dark">
              <Spinner className="size-3" />
              Saving…
            </span>
          ) : (
            <Button
              variant="primary"
              disabled={!buffer.dirty}
              onClick={() => void save(file)}
            >
              Save
            </Button>
          )}
        </span>
      </div>
      {buffer.conflict && (
        <ConflictBanner
          file={file}
          name={fileName(path)}
          current={buffer.conflict.current}
        />
      )}
      <div ref={host} className="min-h-0 flex-1" aria-label="Editor" />
      {view && <FindPanel view={view} state={buffer.state} />}
    </>
  );
}
function ConflictBanner({
  file,
  name,
  current,
}: {
  file: FileKey;
  name: string;
  current: Opened | null;
}) {
  const stopEditing = useStopEditing(file.repo);
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2.5 border-b border-line bg-merge px-3 py-1.5 text-sm text-merge-ink dark:border-line-dark dark:bg-merge-dark dark:text-merge-ink-dark"
    >
      {current ? (
        <span>
          <b>{name} changed on disk</b> since you started editing. Your edits
          are still here.
        </span>
      ) : (
        <span>
          <b>{name} was deleted on disk.</b> Your edits are still here.
        </span>
      )}
      <span className="ml-auto flex gap-1.5">
        {current ? (
          <Button className={outline} onClick={() => reload(file, current)}>
            Reload from disk
          </Button>
        ) : (
          <Button
            className={outline}
            onClick={() => {
              drop(file);
              stopEditing();
            }}
          >
            Discard edits
          </Button>
        )}
        <Button variant="primary" onClick={() => keepEdits(file)}>
          Keep my edits
        </Button>
      </span>
    </div>
  );
}
