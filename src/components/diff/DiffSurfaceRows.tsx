import type { ReactNode } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { markedTokens } from '../../lib/highlight';
import type { Hunk, DiffLine, Source } from '../../lib/types';
import { dynamic, gutterCell } from '../shared/styles';
import type { Expansion } from './expansion';
import { BlankGapRow, GapRow } from './GapRow';
import { HunkHeader } from './HunkHeader';
import type { Row } from './rows';
import type { Tokens } from './tokens';
import { findClass, findTokens, sideIndex, type Found } from './find';
interface LineStyle {
  background: string;
  prefix: string;
  changed: string;
}
const contextStyle: LineStyle = { background: '', prefix: '  ', changed: '' };
const lineStyles: Partial<Record<string, LineStyle>> = {
  add: {
    background: 'bg-add dark:bg-add-dark',
    prefix: '+ ',
    changed: 'bg-add-word dark:bg-add-word-dark',
  },
  remove: {
    background: 'bg-remove dark:bg-remove-dark',
    prefix: '− ',
    changed: 'bg-remove-word dark:bg-remove-word-dark',
  },
  context: contextStyle,
};
export interface DiffContent {
  hunks: Hunk[];
  patches: string[];
}
export interface DisplayOptions {
  split: boolean;
  wrap: boolean;
  whitespace: boolean;
}
export interface HunkControls {
  source: Source;
  disabled: boolean;
  act: (hunk: number, action: string) => void;
}
export interface RowContext {
  diff: DiffContent;
  display: DisplayOptions;
  tokens: Tokens;
  controls: HunkControls;
  expansion: Expansion;
  found: Found | undefined;
}
export type ColumnKind = 'single' | 'left' | 'right';
function styleOf(line: DiffLine | undefined) {
  if (!line) return contextStyle;
  return lineStyles[line.kind] ?? contextStyle;
}
function lineTokens(line: DiffLine | undefined, tokens: Tokens) {
  if (!line) return [{ content: '' }];
  const key = line.kind === 'remove' ? `old:${line.old}` : `new:${line.new}`;
  return tokens[key] ?? [{ content: line.content }];
}
function lineNumberOf(line: DiffLine | undefined, old: boolean) {
  if (!line) return undefined;
  if (old) return line.old;
  return line.new ?? line.old;
}
function formatToken(content: string, whitespace: boolean) {
  if (!whitespace) return content;
  return content.replaceAll(' ', '·').replaceAll('\t', '→   ');
}
function tokenHighlight(
  token: { found?: boolean; current?: boolean; changed?: boolean },
  changedClass: string,
) {
  const foundClass = findClass(token);
  if (foundClass) return foundClass;
  return token.changed ? changedClass : '';
}
function TokenSpan({
  token,
  changedClass,
  whitespace,
}: {
  token: {
    content: string;
    color?: string;
    found?: boolean;
    current?: boolean;
    changed?: boolean;
  };
  changedClass: string;
  whitespace: boolean;
}) {
  return (
    <span
      className={`text-syntax ${tokenHighlight(token, changedClass)}`}
      style={dynamic({ '--syntax-color': token.color ?? 'inherit' })}
    >
      {formatToken(token.content, whitespace)}
    </span>
  );
}
function DiffLineCell({
  line,
  old,
  index,
  context,
}: {
  line: DiffLine | undefined;
  old: boolean;
  index: number;
  context: RowContext;
}) {
  const { display, tokens, found } = context;
  const style = styleOf(line);
  const marked = markedTokens(lineTokens(line, tokens), line?.marks ?? []);
  const rendered = findTokens(marked, found, sideIndex(index, old ? 0 : 1));
  const wrapClass = display.wrap
    ? 'whitespace-pre-wrap break-all'
    : 'whitespace-pre';
  return (
    <div className={`flex min-w-0 flex-1 overflow-hidden ${style.background}`}>
      <span className={`select-none ${gutterCell}`}>
        {lineNumberOf(line, old)}
      </span>
      <code className={`min-w-0 flex-1 pr-4 pl-2 select-text ${wrapClass}`}>
        <span className="select-none">{style.prefix}</span>
        {rendered.map((token, position) => (
          <TokenSpan
            key={position}
            token={token}
            changedClass={style.changed}
            whitespace={display.whitespace}
          />
        ))}
        {line?.noNewline && (
          <span className="ml-2 text-muted" title="No newline at end of file">
            ↵∅
          </span>
        )}
      </code>
    </div>
  );
}
function HunkRowHeader({
  index,
  actions,
  label,
  context,
}: {
  index: number;
  actions: boolean;
  label: boolean;
  context: RowContext;
}) {
  const { diff, controls } = context;
  const stageAction = controls.source === 'staged' ? 'unstage' : 'stage';
  return (
    <HunkHeader
      index={index}
      header={label ? diff.hunks[index].header : ''}
      actions={actions}
      source={controls.source}
      disabled={controls.disabled || !diff.patches[index]}
      stage={() => controls.act(index, stageAction)}
      discard={() => controls.act(index, 'discard')}
    />
  );
}
function SingleColumnCells({
  row,
  index,
  context,
}: {
  row: Row;
  index: number;
  context: RowContext;
}) {
  const splitDivider = context.display.split
    ? 'divide-x divide-line dark:divide-line-dark'
    : '';
  return (
    <div className={`flex min-h-5 ${splitDivider}`}>
      {context.display.split && (
        <DiffLineCell line={row.left} old index={index} context={context} />
      )}
      <DiffLineCell
        line={row.right}
        old={false}
        index={index}
        context={context}
      />
    </div>
  );
}
export function SurfaceRow({
  row,
  index,
  column,
  context,
}: {
  row: Row;
  index: number;
  column: ColumnKind;
  context: RowContext;
}) {
  if (row.gap) {
    if (column === 'right') return <BlankGapRow />;
    return <GapRow gap={row.gap} expansion={context.expansion} />;
  }
  if (row.hunk !== undefined)
    return (
      <HunkRowHeader
        index={row.hunk}
        actions={column !== 'left'}
        label={column !== 'right'}
        context={context}
      />
    );
  if (column === 'left')
    return <DiffLineCell line={row.left} old index={index} context={context} />;
  if (column === 'right')
    return (
      <DiffLineCell
        line={row.right}
        old={false}
        index={index}
        context={context}
      />
    );
  return <SingleColumnCells row={row} index={index} context={context} />;
}
export function VirtualRowStack({
  virtual,
  rows,
  width,
  measure,
  render,
}: {
  virtual: Virtualizer<HTMLDivElement, Element>;
  rows: Row[];
  width: string;
  measure: boolean;
  render: (row: Row, index: number) => ReactNode;
}) {
  return (
    <div
      className="relative h-virtual w-diff"
      style={dynamic({
        '--virtual-height': `${virtual.getTotalSize()}px`,
        '--diff-width': width,
      })}
    >
      {virtual.getVirtualItems().map((row) => (
        <div
          ref={measure ? virtual.measureElement : undefined}
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
}
