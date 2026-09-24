import type { MouseEvent } from 'react';
import { ArrowDownFromLine, ArrowUpFromLine } from 'lucide-react';
import { Spinner } from '../shared/Spinner';
import { focusInset } from '../shared/styles';
import { step, type Direction, type Expansion } from './expansion';
import type { Row } from './rows';
const row =
  'flex h-6 items-stretch border-y border-dashed border-line bg-sub font-sans text-xs text-muted dark:border-line-dark dark:bg-sub-dark dark:text-muted-dark';
const arrow = `grid flex-1 place-items-center text-accent hover:bg-selected dark:text-accent-dark dark:hover:bg-selected-dark ${focusInset}`;
export function BlankGapRow() {
  return <div className={row} />;
}
export function GapRow({
  gap,
  expansion,
}: {
  gap: NonNullable<Row['gap']>;
  expansion: Expansion;
}) {
  const { hidden, kind, hunk } = gap;
  const above = kind === 'end' ? hunk + 1 : hunk;
  const below = hunk + 1;
  const busy = expansion.loading || expansion.tooLarge;
  const stepped = !busy && (hidden === null || hidden > step);
  const press = (direction: Direction) => (event: MouseEvent) => {
    const root = event.currentTarget.closest('[data-diff]');
    expansion.expand(gap, direction);
    if (direction === 'all' || (hidden !== null && hidden <= step))
      requestAnimationFrame(() =>
        root
          ?.querySelector<HTMLElement>(`[data-hunk="${hunk}"]`)
          ?.focus({ preventScroll: true }),
      );
  };
  const label = expansion.loading
    ? 'Loading lines…'
    : expansion.tooLarge
      ? 'File too large to expand'
      : hidden === null
        ? 'Rest of file hidden'
        : `${hidden} hidden line${hidden === 1 ? '' : 's'}${kind === 'top' ? ' above' : kind === 'end' ? ' below' : ''}`;
  return (
    <div className={row}>
      <div className="sticky left-0 flex">
        <div className="flex w-11 shrink-0 border-r border-line bg-gutter dark:border-line-dark dark:bg-gutter-dark">
          {expansion.loading && (
            <span className="grid flex-1 place-items-center text-accent dark:text-accent-dark">
              <Spinner className="size-3.5" />
            </span>
          )}
          {stepped && kind !== 'top' && (
            <button
              type="button"
              title={`Show ${step} more lines below hunk ${above}`}
              aria-label={`Show ${step} more lines below hunk ${above}`}
              className={arrow}
              onClick={press('down')}
            >
              <ArrowDownFromLine className="size-3.5" />
            </button>
          )}
          {stepped && kind !== 'end' && (
            <button
              type="button"
              title={`Show ${step} more lines above hunk ${below}`}
              aria-label={`Show ${step} more lines above hunk ${below}`}
              className={arrow}
              onClick={press('up')}
            >
              <ArrowUpFromLine className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 px-2.5 whitespace-nowrap">
          <span>{label}</span>
          {!busy && (
            <button
              type="button"
              aria-expanded={false}
              aria-label={`Show all ${hidden ?? 'remaining'} lines`}
              className={`h-5.5 rounded px-1.5 font-medium text-accent hover:bg-selected dark:text-accent-dark dark:hover:bg-selected-dark ${focusInset}`}
              onClick={press('all')}
            >
              Show all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
