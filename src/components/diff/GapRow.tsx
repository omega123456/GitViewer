import type { MouseEvent, ReactNode } from 'react';
import { ArrowDownFromLine, ArrowUpFromLine } from 'lucide-react';
import { Spinner } from '../shared/Spinner';
import { clickable, focusInset } from '../shared/styles';
import { step, type Direction, type Expansion } from './expansion';
import type { Gap, Row } from './rows';
import { plural } from '../../lib/text';
const row =
  'flex h-6 items-stretch border-y border-dashed border-line bg-sub font-sans text-xs text-muted dark:border-line-dark dark:bg-sub-dark dark:text-muted-dark';
const arrow = `grid flex-1 place-items-center text-accent hover:bg-selected dark:text-accent-dark dark:hover:bg-selected-dark ${clickable} ${focusInset}`;
type ShownGap = NonNullable<Row['gap']>;
const hiddenSide: Record<Gap['kind'], string> = {
  top: ' above',
  mid: '',
  end: ' below',
};
function gapLabel({ hidden, kind }: ShownGap, expansion: Expansion) {
  if (expansion.loading) return 'Loading lines…';
  if (expansion.tooLarge) return 'File too large to expand';
  if (hidden === null) return 'Rest of file hidden';
  return `${plural(hidden, 'hidden line')}${hiddenSide[kind]}`;
}
function StepButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: (event: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={arrow}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
export function BlankGapRow() {
  return <div className={row} />;
}
export function GapRow({
  gap,
  expansion,
}: {
  gap: ShownGap;
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
  const label = gapLabel(gap, expansion);
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
            <StepButton
              label={`Show ${step} more lines below hunk ${above}`}
              icon={<ArrowDownFromLine className="size-3.5" />}
              onClick={press('down')}
            />
          )}
          {stepped && kind !== 'end' && (
            <StepButton
              label={`Show ${step} more lines above hunk ${below}`}
              icon={<ArrowUpFromLine className="size-3.5" />}
              onClick={press('up')}
            />
          )}
        </div>
        <div className="flex items-center gap-2 px-2.5 whitespace-nowrap">
          <span>{label}</span>
          {!busy && (
            <button
              type="button"
              aria-expanded={false}
              aria-label={`Show all ${hidden ?? 'remaining'} lines`}
              className={`h-5.5 rounded px-1.5 font-medium text-accent hover:bg-selected dark:text-accent-dark dark:hover:bg-selected-dark ${clickable} ${focusInset}`}
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
