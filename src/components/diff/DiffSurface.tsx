import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  type Ref,
  type RefObject,
  type PointerEvent,
} from 'react';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { focusInset } from '../shared/styles';
import type { Expansion } from './expansion';
import { rowHeight, type Row } from './rows';
import type { Tokens } from './tokens';
import { scrollPage } from './scroll';
import type { Found } from './find';
import { isInside } from '../../lib/browser';
import {
  SurfaceRow,
  VirtualRowStack,
  type DiffContent,
  type DisplayOptions,
  type HunkControls,
  type RowContext,
} from './DiffSurfaceRows';
export type {
  DiffContent,
  DisplayOptions,
  HunkControls,
} from './DiffSurfaceRows';
const DIFF_OVERSCAN = 20;
const PREFIX_CHARACTERS = 2;
export interface DiffSurfaceHandle {
  scrollToRow: (index: number, align?: 'start' | 'center') => void;
  focus: () => void;
}
export interface Embedding {
  scroller: RefObject<HTMLDivElement | null>;
  margin: number;
}
function diffWidthFor(characters: number, wrap: boolean) {
  if (wrap) return '100%';
  return `max(100%, calc(${characters + PREFIX_CHARACTERS}ch + 68px))`;
}
function widestLines(rows: Row[]) {
  return rows.reduce(
    (longest, row) => ({
      left: Math.max(longest.left, row.left?.content.length ?? 0),
      right: Math.max(longest.right, row.right?.content.length ?? 0),
    }),
    { left: 0, right: 0 },
  );
}
function useDiffVirtualizer(
  rows: Row[],
  embedding: Embedding | undefined,
  primary: RefObject<HTMLDivElement | null>,
) {
  const scroller = embedding?.scroller;
  const scrollMargin = embedding?.margin ?? 0;
  const itemKey = useCallback(
    (index: number) => rows[index].gap?.key ?? index,
    [rows],
  );
  return useVirtualizer({
    count: rows.length,
    getItemKey: itemKey,
    getScrollElement: () => scroller?.current ?? primary.current,
    initialOffset: () => scroller?.current?.scrollTop ?? 0,
    scrollMargin: scrollMargin,
    estimateSize: (index) => rowHeight(rows[index]),
    overscan: DIFF_OVERSCAN,
  });
}
function SplitSideStack({
  column,
  virtual,
  rows,
  characters,
  context,
}: {
  column: 'left' | 'right';
  virtual: Virtualizer<HTMLDivElement, Element>;
  rows: Row[];
  characters: number;
  context: RowContext;
}) {
  return (
    <VirtualRowStack
      virtual={virtual}
      rows={rows}
      width={diffWidthFor(characters, false)}
      measure={false}
      render={(row, index) => (
        <SurfaceRow row={row} index={index} column={column} context={context} />
      )}
    />
  );
}
interface SplitColumnsProps {
  refs: {
    primary: RefObject<HTMLDivElement | null>;
    secondary: RefObject<HTMLDivElement | null>;
    scroller: RefObject<HTMLDivElement | null> | undefined;
  };
  virtual: Virtualizer<HTMLDivElement, Element>;
  rows: Row[];
  widest: { left: number; right: number };
  context: RowContext;
  onFocusScroller: (event: PointerEvent<HTMLDivElement>) => void;
}
function SplitColumns({
  refs,
  virtual,
  rows,
  widest,
  context,
  onFocusScroller,
}: SplitColumnsProps) {
  const { primary, secondary, scroller } = refs;
  const rightOverflow = scroller
    ? 'overflow-x-auto overflow-y-hidden'
    : 'overflow-auto';
  return (
    <div
      data-diff
      onPointerUp={onFocusScroller}
      className={`flex font-mono text-diff ${scroller ? '' : 'min-h-0 flex-1'}`}
    >
      <div
        ref={secondary}
        aria-label="Previous version"
        className="w-1/2 shrink-0 overflow-x-auto overflow-y-hidden border-r border-line dark:border-line-dark"
        onWheel={(event) => {
          if (primary.current) primary.current.scrollTop += event.deltaY;
        }}
      >
        <SplitSideStack
          column="left"
          virtual={virtual}
          rows={rows}
          characters={widest.left}
          context={context}
        />
      </div>
      <div
        ref={primary}
        tabIndex={scroller ? undefined : -1}
        onKeyDownCapture={scroller ? undefined : scrollPage}
        aria-label="Current version"
        className={`w-1/2 shrink-0 ${focusInset} ${rightOverflow}`}
        onScroll={() => {
          if (primary.current && secondary.current)
            secondary.current.scrollTop = primary.current.scrollTop;
        }}
      >
        <SplitSideStack
          column="right"
          virtual={virtual}
          rows={rows}
          characters={widest.right}
          context={context}
        />
      </div>
    </div>
  );
}
function SingleColumn({
  primary,
  scroller,
  virtual,
  rows,
  width,
  context,
  onFocusScroller,
}: {
  primary: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null> | undefined;
  virtual: Virtualizer<HTMLDivElement, Element>;
  rows: Row[];
  width: string;
  context: RowContext;
  onFocusScroller: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const overflow = scroller
    ? 'overflow-x-auto'
    : 'min-h-0 flex-1 overflow-auto';
  return (
    <div
      ref={primary}
      data-diff
      tabIndex={scroller ? undefined : -1}
      role={scroller ? undefined : 'region'}
      aria-label={scroller ? undefined : 'Diff content'}
      onPointerUp={onFocusScroller}
      onKeyDownCapture={scroller ? undefined : scrollPage}
      className={`font-mono text-diff ${focusInset} ${overflow}`}
    >
      <VirtualRowStack
        virtual={virtual}
        rows={rows}
        width={width}
        measure
        render={(row, index) => (
          <SurfaceRow
            row={row}
            index={index}
            column="single"
            context={context}
          />
        )}
      />
    </div>
  );
}
function focusSurfaceOnPointerUp(
  event: PointerEvent<HTMLDivElement>,
  target: HTMLDivElement | null,
) {
  const clickedText =
    !isInside(event.target, 'button') && getSelection()?.isCollapsed !== false;
  if (clickedText) target?.focus({ preventScroll: true });
}
interface DiffSurfaceProps {
  ref?: Ref<DiffSurfaceHandle>;
  rows: Row[];
  diff: DiffContent;
  display: DisplayOptions;
  tokens: Tokens;
  controls: HunkControls;
  expansion: Expansion;
  embedding?: Embedding;
  found?: Found;
}
export function DiffSurface({
  ref,
  rows,
  diff,
  display,
  tokens,
  controls,
  expansion,
  embedding,
  found,
}: DiffSurfaceProps) {
  const scroller = embedding?.scroller;
  const primary = useRef<HTMLDivElement>(null);
  const secondary = useRef<HTMLDivElement>(null);
  const virtual = useDiffVirtualizer(rows, embedding, primary);
  useImperativeHandle(ref, () => ({
    scrollToRow: (index, align = 'start') =>
      virtual.scrollToIndex(index, { align }),
    focus: () => primary.current?.focus({ preventScroll: true }),
  }));
  const widest = useMemo(() => widestLines(rows), [rows]);
  const focusScroller = (event: PointerEvent<HTMLDivElement>) =>
    focusSurfaceOnPointerUp(event, scroller?.current ?? primary.current);
  const context: RowContext = {
    diff,
    display,
    tokens,
    controls,
    expansion,
    found,
  };
  if (display.split && !display.wrap)
    return (
      <SplitColumns
        refs={{ primary, secondary, scroller }}
        virtual={virtual}
        rows={rows}
        widest={widest}
        context={context}
        onFocusScroller={focusScroller}
      />
    );
  return (
    <SingleColumn
      primary={primary}
      scroller={scroller}
      virtual={virtual}
      rows={rows}
      width={diffWidthFor(widest.right, display.wrap)}
      context={context}
      onFocusScroller={focusScroller}
    />
  );
}
