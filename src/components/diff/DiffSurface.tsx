import {
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { markedTokens } from '../../lib/highlight';
import type { Hunk, DiffLine, Source } from '../../lib/types';
import { dynamic } from '../shared/styles';
import { HunkHeader } from './HunkHeader';
import type { Row } from './rows';
import type { Tokens } from './tokens';
export interface DiffSurfaceHandle {
  scrollToRow: (index: number) => void;
}
function offsetWithin(block: HTMLElement | null, scroller: HTMLElement | null) {
  if (!block || !scroller) return 0;
  return (
    block.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop
  );
}
export function DiffSurface({
  ref,
  rows,
  hunks,
  patches,
  split,
  wrap,
  whitespace,
  tokens,
  source,
  disabled,
  hunkAction,
  scroller,
}: {
  ref?: Ref<DiffSurfaceHandle>;
  rows: Row[];
  hunks: Hunk[];
  patches: string[];
  split: boolean;
  wrap: boolean;
  whitespace: boolean;
  tokens: Tokens;
  source: Source;
  disabled: boolean;
  hunkAction: (hunk: number, action: string) => void;
  scroller?: RefObject<HTMLDivElement | null>;
}) {
  const primary = useRef<HTMLDivElement>(null);
  const secondary = useRef<HTMLDivElement>(null);
  const columns = split && !wrap && !scroller;
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller?.current ?? primary.current,
    scrollMargin: scroller
      ? offsetWithin(primary.current, scroller.current)
      : 0,
    estimateSize: (index) => (rows[index].hunk !== undefined ? 24 : 20),
    overscan: 20,
  });
  useImperativeHandle(ref, () => ({
    scrollToRow: (index: number) =>
      virtual.scrollToIndex(index, { align: 'start' }),
  }));
  const widest = useMemo(
    () =>
      rows.reduce(
        (longest, row) => ({
          left: Math.max(longest.left, row.left?.content.length ?? 0),
          right: Math.max(longest.right, row.right?.content.length ?? 0),
        }),
        { left: 0, right: 0 },
      ),
    [rows],
  );
  const header = (index: number, actions: boolean, label: boolean) => (
    <HunkHeader
      header={label ? hunks[index].header : ''}
      actions={actions}
      source={source}
      disabled={disabled || !patches[index]}
      stage={() => hunkAction(index, source === 'staged' ? 'unstage' : 'stage')}
      discard={() => hunkAction(index, 'discard')}
    />
  );
  const cell = (line: DiffLine | undefined, old: boolean) => (
    <div
      className={`flex min-w-0 flex-1 overflow-hidden ${line?.kind === 'add' ? 'bg-add dark:bg-add-dark' : line?.kind === 'remove' ? 'bg-remove dark:bg-remove-dark' : ''}`}
    >
      <span className="w-11 shrink-0 select-none bg-gutter px-2 text-right text-label text-faint dark:bg-gutter-dark dark:text-faint-dark">
        {old ? line?.old : (line?.new ?? line?.old)}
      </span>
      <code
        className={`file-content min-w-0 flex-1 pr-4 pl-2 ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}
      >
        <span className="select-none">
          {line?.kind === 'add' ? '+ ' : line?.kind === 'remove' ? '− ' : '  '}
        </span>
        {markedTokens(
          tokens[
            `${old || line?.kind === 'remove' ? 'old' : 'new'}:${old || line?.kind === 'remove' ? line?.old : line?.new}`
          ] ?? [{ content: line?.content ?? '' }],
          line?.marks ?? [],
        ).map((token, index) => (
          <span
            key={index}
            className={`text-syntax ${token.changed ? (line?.kind === 'add' ? 'bg-add-word dark:bg-add-word-dark' : 'bg-remove-word dark:bg-remove-word-dark') : ''}`}
            style={dynamic({ '--syntax-color': token.color ?? 'inherit' })}
          >
            {whitespace
              ? token.content.replaceAll(' ', '·').replaceAll('\t', '→   ')
              : token.content}
          </span>
        ))}
        {line?.noNewline && (
          <span className="ml-2 text-muted" title="No newline at end of file">
            ↵∅
          </span>
        )}
      </code>
    </div>
  );
  const stack = (
    side: 'left' | 'right',
    render: (row: Row, index: number) => ReactNode,
  ) => (
    <div
      className="relative h-virtual w-diff"
      style={dynamic({
        '--virtual-height': `${virtual.getTotalSize()}px`,
        '--diff-width': wrap
          ? '100%'
          : `max(100%, calc(${widest[side] + 2}ch + 68px))`,
      })}
    >
      {virtual.getVirtualItems().map((row) => (
        <div
          ref={columns ? undefined : virtual.measureElement}
          data-index={row.index}
          key={row.key}
          className="absolute top-0 left-0 w-full translate-y-row"
          style={dynamic({
            '--row-offset': `${row.start - virtual.options.scrollMargin}px`,
          })}
        >
          {render(rows[row.index], row.index)}
        </div>
      ))}
    </div>
  );
  if (!columns)
    return (
      <div
        ref={primary}
        className={`font-mono text-diff ${scroller ? 'overflow-x-auto' : 'min-h-0 flex-1 overflow-auto'}`}
      >
        {stack('right', (value) =>
          value.hunk !== undefined ? (
            header(value.hunk, true, true)
          ) : (
            <div
              className={`flex min-h-5 ${split ? 'divide-x divide-line dark:divide-line-dark' : ''}`}
            >
              {split && cell(value.left, true)}
              {cell(value.right, false)}
            </div>
          ),
        )}
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 font-mono text-diff">
      <div
        ref={secondary}
        aria-label="Previous version"
        className="w-1/2 shrink-0 overflow-x-auto overflow-y-hidden border-r border-line dark:border-line-dark"
        onWheel={(event) => {
          if (primary.current) primary.current.scrollTop += event.deltaY;
        }}
      >
        {stack('left', (value) =>
          value.hunk !== undefined
            ? header(value.hunk, false, true)
            : cell(value.left, true),
        )}
      </div>
      <div
        ref={primary}
        aria-label="Current version"
        className="w-1/2 shrink-0 overflow-auto"
        onScroll={() => {
          if (primary.current && secondary.current)
            secondary.current.scrollTop = primary.current.scrollTop;
        }}
      >
        {stack('right', (value) =>
          value.hunk !== undefined
            ? header(value.hunk, true, false)
            : cell(value.right, false),
        )}
      </div>
    </div>
  );
}
