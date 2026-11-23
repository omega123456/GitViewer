import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useBackend } from '../../lib/query';
import type { Diff, DiffStack, Selection, Settings } from '../../lib/types';
import type { DiffSurfaceHandle } from './DiffSurface';
import { foundInRows, lineKey, type LineFound, type Located } from './find';
import { useExpansion, type Openings } from './expansion';
import { useDiffFile } from './useDiffFile';
import {
  DIFF_CONTEXT_LINES,
  DIVIDER_ROW_HEIGHT,
  LINE_ROW_HEIGHT,
  rowHeight,
  type Row,
} from './rows';
import { useTokens } from './tokens';
import type { StackEntry } from './stack-entries';
import { StackFileBody, StackFileHeader } from './StackFileView';
const SETTLE_MS = 150;
const noOpenings: Openings = {};
const FILE_HEADER_HEIGHT = 35;
const FILE_NOTE_HEIGHT = 128;
export interface Batch {
  data?: DiffStack;
  error: Error | null;
  settled: boolean;
  version: number;
}
export interface PaneContext {
  repo: string;
  batch: Batch;
  settings: Settings;
  disabled: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  eager: RefObject<boolean>;
  setClosed: Dispatch<SetStateAction<Record<string, boolean>>>;
  setOpenings: Dispatch<SetStateAction<Record<string, Openings>>>;
  onJumped: () => void;
}
interface GateRefs {
  box: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
  eager: RefObject<boolean>;
}
function fileNote(data: Diff | undefined, error: Error | null) {
  if (error) return error.message;
  if (!data) return 'Loading…';
  if (data.tooLarge) return 'File too large to diff. Select it to view anyway.';
  if (data.binary) return 'Binary file.';
  const unchanged =
    !data.image && data.content === null && data.hunks.length === 0;
  if (unchanged) return 'No content change.';
  return null;
}
export function estimateFileHeight(data: Diff | undefined, open: boolean) {
  const header = FILE_HEADER_HEIGHT;
  if (!open) return header;
  if (!data || data.image || fileNote(data, null))
    return header + FILE_NOTE_HEIGHT;
  const lines =
    data.content !== null
      ? data.content.split('\n').length
      : data.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  return (
    header + lines * LINE_ROW_HEIGHT + data.hunks.length * DIVIDER_ROW_HEIGHT
  );
}
function useVisibilityGate(refs: GateRefs, report: (visible: boolean) => void) {
  const { box, scroller, eager } = refs;
  const latest = useRef(report);
  useEffect(() => {
    latest.current = report;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let immediate = eager.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[entries.length - 1].isIntersecting;
        clearTimeout(timer);
        if (immediate) {
          latest.current(visible);
          immediate = false;
          return;
        }
        timer = setTimeout(() => latest.current(visible), SETTLE_MS);
      },
      { root: scroller.current, rootMargin: '400px' },
    );
    const element = box.current;
    if (element) observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [box, scroller, eager]);
}
function useFileDiffData(
  repo: string,
  selection: Selection,
  source: { batch: Batch; near: boolean },
) {
  const { batch, near } = source;
  const stacked = batch.data?.files[selection.path];
  const missing = batch.settled && !stacked;
  const fallback = useBackend(
    'diff',
    { repo: repo, ...selection, context: DIFF_CONTEXT_LINES },
    missing && near,
  );
  const data = stacked ?? (missing ? fallback.data : undefined);
  const fallbackError = missing ? fallback.error : null;
  const error = stacked ? null : (batch.error ?? fallbackError);
  const version = stacked ? batch.version : fallback.dataUpdatedAt;
  return { data, error, version };
}
function useJumpToLine({
  jump,
  surface,
  rows,
  handle,
  onJumped,
}: {
  jump: Located | undefined;
  surface: boolean;
  rows: Row[];
  handle: RefObject<DiffSurfaceHandle | null>;
  onJumped: () => void;
}) {
  useEffect(() => {
    if (!jump || !surface) return;
    const rowIndex = rows.findIndex((row) =>
      [row.left, row.right].some((line) => line && lineKey(line) === jump.key),
    );
    handle.current?.scrollToRow(rowIndex, 'center');
    onJumped();
  }, [jump, surface, rows, handle, onJumped]);
}
function useFileOpening(
  path: string,
  setOpenings: Dispatch<SetStateAction<Record<string, Openings>>>,
) {
  return useCallback(
    (action: SetStateAction<Openings>) =>
      setOpenings((all) => ({
        ...all,
        [path]:
          typeof action === 'function'
            ? action(all[path] ?? noOpenings)
            : action,
      })),
    [path, setOpenings],
  );
}
interface StackFileControllerParams {
  pane: PaneContext;
  selection: Selection;
  open: boolean;
  opening: Openings | undefined;
  found: LineFound | undefined;
  jump: Located | undefined;
}
function useFileVisibility(
  box: RefObject<HTMLDivElement | null>,
  scroller: RefObject<HTMLDivElement | null>,
  eager: RefObject<boolean>,
) {
  const [near, setNear] = useState(false);
  const [mounted, setMounted] = useState(false);
  useVisibilityGate({ box, scroller, eager }, (visible) => {
    setNear(visible);
    if (visible) setMounted(true);
  });
  return { near, mounted };
}
function useBodyOffset(
  body: RefObject<HTMLDivElement | null>,
  surface: boolean,
) {
  const [inner, setInner] = useState(0);
  useLayoutEffect(() => {
    setInner(body.current?.offsetTop ?? 0);
  }, [body, surface]);
  return inner;
}
function useStackFileController(params: StackFileControllerParams) {
  const { pane, selection, open, opening, found, jump } = params;
  const { repo, batch, settings, scroller, eager, setOpenings, onJumped } =
    pane;
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const handle = useRef<DiffSurfaceHandle>(null);
  const { near, mounted } = useFileVisibility(box, scroller, eager);
  const { data, error, version } = useFileDiffData(repo, selection, {
    batch,
    near,
  });
  const setOpening = useFileOpening(selection.path, setOpenings);
  const target = { repo, selection, data };
  const expansion = useExpansion(target, {
    openings: opening ?? noOpenings,
    setOpenings: setOpening,
  });
  const tokens = useTokens(target, near);
  const diffFile = useDiffFile({
    repo: repo,
    selection: selection,
    data: data,
    reveal: expansion.reveal,
    defaultMode: settings.diffMode,
  });
  const message = fileNote(data, error);
  const surface = open && !message && mounted;
  const marked = useMemo(
    () => foundInRows(diffFile.rows, found),
    [diffFile.rows, found],
  );
  useJumpToLine({
    jump: jump,
    surface: surface,
    rows: diffFile.rows,
    handle: handle,
    onJumped: onJumped,
  });
  const inner = useBodyOffset(body, surface);
  const reserved = diffFile.rows.reduce((sum, row) => sum + rowHeight(row), 0);
  return {
    box,
    body,
    handle,
    data,
    version,
    expansion,
    tokens,
    diffFile,
    message,
    mounted,
    marked,
    inner,
    reserved,
  };
}
type StackFileModel = ReturnType<typeof useStackFileController>;
function buildStackFileStates({
  pane,
  model,
  path,
  open,
  start,
}: {
  pane: PaneContext;
  model: StackFileModel;
  path: string;
  open: boolean;
  start: number;
}) {
  return {
    header: {
      open: open,
      data: model.data,
      counts: model.diffFile.counts,
      expansion: model.expansion,
      maxFileTabs: pane.settings.maxFileTabs,
      onToggleOpen: () =>
        pane.setClosed((all) => ({ ...all, [path]: !all[path] })),
    },
    body: {
      data: model.data,
      message: model.message,
      mounted: model.mounted,
      reserved: model.reserved,
      version: model.version,
      rows: model.diffFile.rows,
      split: model.diffFile.split,
      tokens: model.tokens,
      marked: model.marked,
      disabled: pane.disabled,
      hunkAction: model.diffFile.hunkAction,
      scroller: pane.scroller,
      margin: start + model.inner,
      expansion: model.expansion,
    },
  };
}
interface StackFileDiffProps {
  pane: PaneContext;
  entry: StackEntry;
  start: number;
  closed: boolean;
  opening?: Openings;
  found?: LineFound;
  jump?: Located;
}
export const FileDiff = memo(function FileDiff({
  pane,
  entry: { selection, badge },
  start,
  closed,
  opening,
  found,
  jump,
}: StackFileDiffProps) {
  const open = !closed;
  const model = useStackFileController({
    pane,
    selection,
    open,
    opening,
    found,
    jump,
  });
  const states = buildStackFileStates({
    pane: pane,
    model: model,
    path: selection.path,
    open: open,
    start: start,
  });
  return (
    <div ref={model.box} className="border-b border-line dark:border-line-dark">
      <StackFileHeader
        repo={pane.repo}
        selection={selection}
        badge={badge}
        state={states.header}
      />
      {open && (
        <StackFileBody
          repo={pane.repo}
          selection={selection}
          bodyRef={model.body}
          handleRef={model.handle}
          state={states.body}
        />
      )}
    </div>
  );
});
