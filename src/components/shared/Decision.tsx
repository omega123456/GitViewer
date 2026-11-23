import { useRef, type RefObject } from 'react';
import { Popover } from 'radix-ui';
import {
  answer,
  useDecision,
  type Decision as PendingDecision,
  type DecisionSlot,
} from '../../stores/decision';
import { Button } from './Button';
import { flyout } from './styles';
function AffectedPaths({ paths }: { paths?: string[] }) {
  if (!paths || paths.length === 0) return null;
  return (
    <ul aria-label="Affected files" className="flex flex-wrap gap-1">
      {paths.map((path) => (
        <li
          key={path}
          className="rounded-full border border-line bg-sub px-2 font-mono text-badge dark:border-line-dark dark:bg-sub-dark"
        >
          {path}
        </li>
      ))}
    </ul>
  );
}
function DecisionButtons({
  repo,
  decision,
  primary,
}: {
  repo: string;
  decision: PendingDecision;
  primary: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="mr-auto text-label text-faint dark:text-faint-dark">
        Esc to cancel
      </span>
      <Button variant="standard" onClick={() => answer(repo, false)}>
        Cancel
      </Button>
      <Button
        ref={primary}
        variant="primary"
        onClick={() => answer(repo, true)}
      >
        {decision.confirm}
      </Button>
    </div>
  );
}
function DecisionContent({
  repo,
  decision,
}: {
  repo: string;
  decision: PendingDecision;
}) {
  const primary = useRef<HTMLButtonElement>(null);
  const focusPrimary = (event: Event) => {
    event.preventDefault();
    primary.current?.focus();
  };
  return (
    <Popover.Content
      align="start"
      sideOffset={6}
      aria-label={decision.title}
      onOpenAutoFocus={focusPrimary}
      onFocusOutside={focusPrimary}
      className={`z-40 flex w-toast max-w-full flex-col gap-2.5 p-3.5 text-sm ${flyout}`}
    >
      <h2 className="text-sm font-semibold">{decision.title}</h2>
      <p className="text-muted dark:text-muted-dark">{decision.body}</p>
      <AffectedPaths paths={decision.paths} />
      {decision.note && (
        <p className="text-muted dark:text-muted-dark">{decision.note}</p>
      )}
      <DecisionButtons repo={repo} decision={decision} primary={primary} />
    </Popover.Content>
  );
}
export function Decision({
  repo,
  slot,
  className,
}: {
  repo: string;
  slot: DecisionSlot;
  className: string;
}) {
  const decision = useDecision((state) => state.pending[repo]);
  const open = decision?.slot === slot;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) answer(repo, false);
      }}
    >
      <Popover.Anchor className={`pointer-events-none absolute ${className}`} />
      <Popover.Portal>
        {open && <DecisionContent repo={repo} decision={decision} />}
      </Popover.Portal>
    </Popover.Root>
  );
}
