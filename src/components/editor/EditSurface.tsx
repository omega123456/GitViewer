import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { FileWarning, Replace } from 'lucide-react';
import { findNext, findPrevious, searchPanelOpen } from '@codemirror/search';
import type { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useActions } from '../../lib/actions';
import { fileName } from '../../lib/paths';
import { useBackend } from '../../lib/query';
import type { Opened } from '../../lib/types';
import {
  applyReconciliation,
  current,
  openBuffer,
  reconcile,
  remember,
  track,
  useBuffer,
  type Buffer,
  type FileKey,
} from '../../stores/editor';
import { useStopEditing } from '../../lib/open-file';
import { useDark } from '../../lib/theme';
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
import { ConflictBanner, EditorToolbar } from './EditorChrome';
import { scopeKey } from '../../lib/git';
import { findActionSet } from '../diff/FindControls';
function useBufferSync({
  file,
  opened,
  base,
  ready,
  dark,
}: {
  file: FileKey;
  opened: { isSuccess: boolean; data: Opened | null | undefined };
  base: { isPending: boolean; data: string | null | undefined };
  ready: Buffer | undefined;
  dark: boolean;
}) {
  const stopEditing = useStopEditing(file.repo);
  const seen = useRef(opened.data);
  useEffect(() => {
    const data = opened.data;
    const canInitialize = opened.isSuccess && data && !ready && !base.isPending;
    if (!canInitialize) return;
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
    const canReconcile =
      opened.isSuccess && ready && !ready.saving && !ready.conflict;
    if (!canReconcile || opened.data === seen.current) return;
    seen.current = opened.data;
    applyReconciliation(file, reconcile(ready, opened.data ?? null));
  }, [opened.isSuccess, opened.data, ready, file]);
}
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
  useBufferSync({ file, opened, base, ready, dark });
  if (opened.error)
    return (
      <ErrorState
        title="Could not open this file"
        error={opened.error}
        retry={() => void opened.refetch()}
      />
    );
  const uneditableFile = opened.isSuccess && opened.data === null && !ready;
  if (uneditableFile)
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
function useEditorMount(file: FileKey, host: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<EditorView>();
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
  }, [file, host]);
  return view;
}
function useEditorEffects({
  view,
  buffer,
  base,
  dark,
  wrap,
  toggleWrap,
  path,
}: {
  view: EditorView | undefined;
  buffer: Buffer;
  base: string | null | undefined;
  dark: boolean;
  wrap: boolean;
  toggleWrap: () => void;
  path: string;
}) {
  const [language, setLanguage] = useState(
    () => describeLanguage(path)?.name ?? 'Plain text',
  );
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
  return language;
}
function useEditorActions(
  repo: string,
  view: EditorView | undefined,
  buffer: Buffer,
) {
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
  const view = useEditorMount(file, host);
  const language = useEditorEffects({
    view: view,
    buffer: buffer,
    base: base,
    dark: dark,
    wrap: wrap,
    toggleWrap: toggleWrap,
    path: path,
  });
  useEditorActions(repo, view, buffer);
  return (
    <>
      <EditorToolbar
        file={file}
        buffer={buffer}
        language={language}
        view={view}
        wrap={wrap}
        toggleWrap={toggleWrap}
      />
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
