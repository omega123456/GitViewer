import { useEffect, useRef, useState } from 'react';
import { FileWarning, RotateCcw, Search } from 'lucide-react';
import { isolateHistory } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useBackend } from '../../lib/query';
import type { Opened } from '../../lib/types';
import {
  approveDiscard,
  conflict,
  drop,
  fileName,
  keepEdits,
  openBuffer,
  reload,
  save,
  track,
  useBuffer,
  type Buffer,
} from '../../stores/editor';
import { stopEditing } from '../../stores/selection';
import { useDark } from '../../stores/theme';
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
  themeSlot,
} from './setup';
const outline =
  'border border-line bg-surface text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';
export default function EditSurface({
  repo,
  path,
}: {
  repo: string;
  path: string;
}) {
  const opened = useBackend('file_read', { repo, path });
  const base = useBackend('file_lines', { repo, path, source: 'staged' });
  const ready = useBuffer(repo, path);
  const dark = useDark();
  const seen = useRef(opened.data);
  useEffect(() => {
    const data = opened.data;
    if (!opened.isSuccess || !data || ready || base.isPending) return;
    seen.current = data;
    openBuffer(
      repo,
      path,
      data,
      createState({
        text: data.text,
        base: base.data,
        dark,
        leave: () => stopEditing(repo),
      }),
    );
  }, [
    opened.isSuccess,
    opened.data,
    ready,
    base.isPending,
    base.data,
    dark,
    repo,
    path,
  ]);
  useEffect(() => {
    if (!opened.isSuccess || !ready || ready.saving || ready.conflict) return;
    const data = opened.data;
    if (data === seen.current) return;
    seen.current = data;
    if ((data?.version ?? null) === ready.version) return;
    if (ready.dirty) conflict(repo, path, data);
    else if (data) reload(repo, path, data);
    else drop(repo, path);
  }, [opened.isSuccess, opened.data, ready, repo, path]);
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
      repo={repo}
      path={path}
      buffer={ready}
      base={base.data}
      dark={dark}
    />
  );
}
function Editor({
  repo,
  path,
  buffer,
  base,
  dark,
}: {
  repo: string;
  path: string;
  buffer: Buffer;
  base: string | null | undefined;
  dark: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView>();
  const [language, setLanguage] = useState(
    () => describeLanguage(path)?.name ?? 'Plain text',
  );
  const initial = useRef(buffer.state);
  useEffect(() => {
    const created = new EditorView({
      state: initial.current,
      parent: host.current!,
      dispatchTransactions: (transactions: readonly Transaction[], target) => {
        target.update(transactions);
        track(repo, path, target.state);
      },
    });
    setView(created);
    return () => created.destroy();
  }, [repo, path]);
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
  const head = buffer.state.selection.main.head;
  const line = buffer.state.doc.lineAt(head);
  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-sub px-2 dark:border-line-dark dark:bg-sub-dark">
        <span className="flex gap-2.5 text-meta text-muted dark:text-muted-dark">
          <span>{language}</span>
          <span>{buffer.bom ? 'UTF-8 with BOM' : 'UTF-8'}</span>
          <span>{buffer.crlf ? 'CRLF' : 'LF'}</span>
          <span className="tabular-nums">
            Ln {line.number}, Col {head - line.from + 1}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Button
            className="text-muted dark:text-muted-dark"
            disabled={!view}
            onClick={() => view && openSearchPanel(view)}
          >
            <Search className="size-4" />
            <span>Find</span>
          </Button>
          <Button
            className="text-muted dark:text-muted-dark"
            disabled={!view || !buffer.dirty || buffer.saving}
            onClick={async () => {
              if (!view || !(await approveDiscard(repo, path))) return;
              view.dispatch({
                changes: {
                  from: 0,
                  to: view.state.doc.length,
                  insert: buffer.saved,
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
              onClick={() => void save(repo, path)}
            >
              Save
            </Button>
          )}
        </span>
      </div>
      {buffer.conflict && (
        <ConflictBanner
          repo={repo}
          path={path}
          name={fileName(path)}
          current={buffer.conflict.current}
        />
      )}
      <div ref={host} className="min-h-0 flex-1" aria-label="Editor" />
    </>
  );
}
function ConflictBanner({
  repo,
  path,
  name,
  current,
}: {
  repo: string;
  path: string;
  name: string;
  current: Opened | null;
}) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2.5 border-b border-line bg-merge px-3 py-1.5 text-xs text-merge-ink dark:border-line-dark dark:bg-merge-dark dark:text-merge-ink-dark"
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
          <Button
            className={outline}
            onClick={() => reload(repo, path, current)}
          >
            Reload from disk
          </Button>
        ) : (
          <Button
            className={outline}
            onClick={() => {
              drop(repo, path);
              stopEditing(repo);
            }}
          >
            Discard edits
          </Button>
        )}
        <Button variant="primary" onClick={() => keepEdits(repo, path)}>
          Keep my edits
        </Button>
      </span>
    </div>
  );
}
