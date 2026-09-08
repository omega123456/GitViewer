import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { focus } from './styles';
export function Section({
  title,
  count,
  icon,
  defaultOpen = true,
  grow = true,
  open,
  onOpenChange,
  actions,
  children,
}: {
  title: string;
  count?: number;
  icon?: ReactNode;
  defaultOpen?: boolean;
  grow?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [internal, setInternal] = useState(defaultOpen);
  const expanded = open ?? internal;
  return (
    <div
      className={`flex min-h-0 flex-col ${expanded && grow ? 'flex-1' : 'shrink-0'}`}
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
export function GroupHeader({
  title,
  count,
  actions,
}: {
  title: string;
  count: number;
  actions?: ReactNode;
}) {
  return (
    <h3 className="flex h-group shrink-0 items-center gap-1 px-2 text-label font-semibold tracking-wider text-faint uppercase dark:text-faint-dark">
      {title}
      <span className="ml-auto font-mono">{count}</span>
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
