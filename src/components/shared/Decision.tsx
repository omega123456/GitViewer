import { useRef } from 'react';
import { Popover } from 'radix-ui';
import { answer, useDecision, type DecisionSlot } from '../../stores/decision';
import { Button } from './Button';
export function Decision({
  repo,
  slot,
  className,
}: {
  repo: string;
  slot: DecisionSlot;
  className: string;
}) {
  const decision = useDecision((s) => s.pending[repo]);
  const primary = useRef<HTMLButtonElement>(null);
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
        {open && (
          <Popover.Content
            align="start"
            sideOffset={6}
            aria-label={decision.title}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              primary.current?.focus();
            }}
            onFocusOutside={(event) => {
              event.preventDefault();
              primary.current?.focus();
            }}
            className="z-40 flex w-toast max-w-full flex-col gap-2.5 rounded-md border border-line bg-surface p-3.5 text-xs text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          >
            <h2 className="text-sm font-semibold">{decision.title}</h2>
            <p className="text-muted dark:text-muted-dark">{decision.body}</p>
            {decision.paths && decision.paths.length > 0 && (
              <ul aria-label="Affected files" className="flex flex-wrap gap-1">
                {decision.paths.map((path) => (
                  <li
                    key={path}
                    className="rounded-full border border-line bg-sub px-2 font-mono text-label dark:border-line-dark dark:bg-sub-dark"
                  >
                    {path}
                  </li>
                ))}
              </ul>
            )}
            {decision.note && (
              <p className="text-muted dark:text-muted-dark">{decision.note}</p>
            )}
            <div className="flex items-center justify-end gap-1.5">
              <span className="mr-auto text-label text-faint dark:text-faint-dark">
                Esc to cancel
              </span>
              <Button
                className="border border-line dark:border-line-dark"
                onClick={() => answer(repo, false)}
              >
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
          </Popover.Content>
        )}
      </Popover.Portal>
    </Popover.Root>
  );
}
