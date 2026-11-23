import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { clickable, focus } from './styles';
import { LineCount } from './LineCount';
import type { Lines } from '../../lib/types';
const TIGHT_HYSTERESIS = 0.5;
export function Section({
  title,
  count,
  icon,
  open,
  onOpenChange,
  actions,
  children,
}: {
  title: string;
  count?: number;
  icon?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [internal, setInternal] = useState(true);
  const expanded = open ?? internal;
  return (
    <div
      role="region"
      aria-label={title}
      className={`flex min-h-0 flex-col ${expanded ? 'flex-1' : 'shrink-0'}`}
    >
      <div className="flex h-section shrink-0 items-center gap-1.5 border-b border-line bg-sub pr-2 pl-2.5 dark:border-line-dark dark:bg-sub-dark">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() =>
            onOpenChange ? onOpenChange(!expanded) : setInternal(!expanded)
          }
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-label font-semibold text-muted dark:text-muted-dark ${clickable} ${focus}`}
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {icon}
          {title}
          {count !== undefined && <CountPill count={count} />}
        </button>
        {expanded && actions}
      </div>
      <div className={expanded ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        {children}
      </div>
    </div>
  );
}
function visible(
  element: Element | null,
  step: 'previousElementSibling' | 'nextElementSibling',
) {
  let current = element;
  while (current && current.getBoundingClientRect().width === 0)
    current = current[step];
  return current?.getBoundingClientRect();
}
interface HeaderParts {
  element: HTMLElement;
  total: HTMLElement;
  folder: HTMLElement | null;
}
interface HeaderMemory {
  room: number;
  spacing: number;
}
interface HeaderFit {
  available: number;
  required: number;
}
function isInteracting(element: HTMLElement) {
  return element.matches(':hover, :focus-within');
}
interface Neighbours {
  folds?: DOMRect;
  after?: DOMRect;
}
function rememberGaps(
  memory: HeaderMemory,
  count: DOMRect,
  neighbours: Neighbours,
) {
  const { folds, after } = neighbours;
  const shown = Boolean(folds && folds.width > 0);
  if (folds && shown) memory.room = folds.right - count.right;
  if (after) memory.spacing = after.left - count.right;
  return shown;
}
function headerFit(parts: HeaderParts, memory: HeaderMemory) {
  const { element, total, folder } = parts;
  if (isInteracting(element)) return undefined;
  const box = element.getBoundingClientRect();
  const first = visible(element.firstElementChild, 'nextElementSibling');
  const last = visible(element.lastElementChild, 'previousElementSibling');
  const before = visible(
    total.previousElementSibling,
    'previousElementSibling',
  );
  const after = visible(total.nextElementSibling, 'nextElementSibling');
  if (!first || !last || !before) return undefined;
  const count = total.getBoundingClientRect();
  const shown = rememberGaps(memory, count, {
    folds: folder?.getBoundingClientRect(),
    after: after,
  });
  const hiddenFolds = shown ? memory.room : 0;
  const required =
    before.right -
    first.left +
    memory.spacing +
    last.right -
    count.left -
    hiddenFolds;
  const margin = first.left - box.left;
  const fit: HeaderFit = {
    available: box.width - margin - margin,
    required: required,
  };
  return fit;
}
function stillTight(fit: HeaderFit, room: number, previouslyTight: boolean) {
  const hysteresis = previouslyTight ? TIGHT_HYSTERESIS : 0;
  return fit.available - fit.required < room + hysteresis;
}
interface HeaderContent {
  title: string;
  count: number;
  lines?: Lines;
}
function useTightHeader(folding: boolean, content: HeaderContent) {
  const header = useRef<HTMLHeadingElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const folder = useRef<HTMLSpanElement>(null);
  const memory = useRef<HeaderMemory>({ room: 0, spacing: 0 });
  const [tight, setTight] = useState(false);
  const { title, count, lines } = content;
  useLayoutEffect(() => {
    const element = header.current;
    const total = counter.current;
    if (!folding || !element || !total) return;
    const measure = () => {
      const parts = { element: element, total: total, folder: folder.current };
      const fit = headerFit(parts, memory.current);
      if (!fit) return;
      setTight((previouslyTight) =>
        stillTight(fit, memory.current.room, previouslyTight),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [folding, lines, count, title]);
  return { header: header, counter: counter, folder: folder, tight: tight };
}
export function GroupHeader({
  title,
  count,
  lines,
  folds,
  actions,
}: {
  title: string;
  count: number;
  lines?: Lines;
  folds?: ReactNode;
  actions?: ReactNode;
}) {
  const { header, counter, folder, tight } = useTightHeader(Boolean(folds), {
    title,
    count,
    lines,
  });
  return (
    <h3
      ref={header}
      className="group/header mt-1 flex h-group shrink-0 items-center gap-1.5 overflow-hidden pr-2 pl-2.5 text-label font-semibold whitespace-nowrap text-muted dark:text-muted-dark"
    >
      <span>{title}</span>
      <LineCount
        lines={lines}
        className={`ml-0.5 ${tight ? 'group-focus-within/header:hidden group-hover/header:hidden' : ''}`}
      />
      <span ref={counter} className="ml-auto font-mono text-badge font-normal">
        {count}
      </span>
      {folds && (
        <span
          ref={folder}
          className={`gap-1 ${tight ? 'hidden group-focus-within/header:flex group-hover/header:flex' : 'flex'}`}
        >
          {folds}
        </span>
      )}
      {actions}
    </h3>
  );
}
function CountPill({ count }: { count: number }) {
  return (
    <span className="ml-auto rounded-full bg-hover px-1.5 font-mono font-normal dark:bg-hover-dark">
      {count}
    </span>
  );
}
