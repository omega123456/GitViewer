import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { focus } from './styles';
import { LineCount } from './LineCount';
import type { Lines } from '../../lib/types';
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
      <div className="flex h-section shrink-0 items-center gap-1 border-b border-line bg-sub px-2 dark:border-line-dark dark:bg-sub-dark">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() =>
            onOpenChange ? onOpenChange(!expanded) : setInternal(!expanded)
          }
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-label font-semibold tracking-wider text-muted uppercase ${focus}`}
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
  const header = useRef<HTMLHeadingElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const folder = useRef<HTMLSpanElement>(null);
  const room = useRef(0);
  const spacing = useRef(0);
  const [tight, setTight] = useState(false);
  const folding = Boolean(folds);
  useLayoutEffect(() => {
    const element = header.current;
    const total = counter.current;
    if (!folding || !element || !total) return;
    const measure = () => {
      if (element.matches(':hover, :focus-within')) return;
      const box = element.getBoundingClientRect();
      const first = visible(element.firstElementChild, 'nextElementSibling');
      const last = visible(element.lastElementChild, 'previousElementSibling');
      const before = visible(
        total.previousElementSibling,
        'previousElementSibling',
      );
      const after = visible(total.nextElementSibling, 'nextElementSibling');
      if (!first || !last || !before) return;
      const count = total.getBoundingClientRect();
      const folds = folder.current?.getBoundingClientRect();
      const shown = Boolean(folds && folds.width > 0);
      if (folds && shown) room.current = folds.right - count.right;
      if (after) spacing.current = after.left - count.right;
      const gap = spacing.current;
      const required =
        before.right -
        first.left +
        gap +
        last.right -
        count.left -
        (shown ? room.current : 0);
      const available = box.width - 2 * (first.left - box.left);
      setTight((was) => available - required < room.current + (was ? 0.5 : 0));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [folding, lines, count, title]);
  return (
    <h3
      ref={header}
      className="group/header flex h-group shrink-0 items-center gap-1 overflow-hidden px-2 text-label font-semibold tracking-wider whitespace-nowrap text-faint uppercase dark:text-faint-dark"
    >
      <span>{title}</span>
      <LineCount
        lines={lines}
        className={`ml-0.5 ${tight ? 'group-focus-within/header:hidden group-hover/header:hidden' : ''}`}
      />
      <span ref={counter} className="ml-auto font-mono">
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
    <span className="ml-auto rounded-full bg-hover px-1.5 font-mono font-normal tracking-normal dark:bg-hover-dark">
      {count}
    </span>
  );
}
