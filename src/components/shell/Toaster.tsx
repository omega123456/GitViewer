import { useEffect, useRef } from 'react';
import { Toaster as Stack, toast } from 'sonner';
import type { ReactNode } from 'react';
import { Check, FolderGit2, RotateCw, Undo2, X } from 'lucide-react';
import { describe, type Recovery } from '../../lib/failure';
import { perform } from '../../lib/query';
import { showWorktree } from '../../lib/repository';
import { unapplyWorktree } from '../../lib/worktree';
import { appScope, useErrors, type Failure } from '../../stores/errors';
import { useSuccesses, type Notice } from '../../stores/successes';
import { useActiveView } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Details } from '../shared/Details';
import { Spinner } from '../shared/Spinner';
const tones = {
  success: {
    card: 'border-success/22 bg-success-ground dark:border-success-dark/22 dark:bg-success-ground-dark',
    icon: 'bg-success text-success-ground dark:bg-success-dark dark:text-success-ground-dark',
  },
  critical: {
    card: 'border-critical/22 bg-critical-ground dark:border-critical-dark/22 dark:bg-critical-ground-dark',
    icon: 'bg-critical text-critical-ground dark:bg-critical-dark dark:text-critical-ground-dark',
  },
  caution: {
    card: 'border-caution/22 bg-caution-ground dark:border-caution-dark/22 dark:bg-caution-ground-dark',
    icon: 'bg-caution text-caution-ground dark:bg-caution-dark dark:text-caution-ground-dark',
  },
  info: {
    card: 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark',
    icon: 'bg-accent text-on-accent dark:bg-accent-dark dark:text-on-accent-dark',
  },
};
type Tone = keyof typeof tones;
const card =
  'flex w-toast gap-3 rounded-md border py-3 pr-3 pl-3.5 font-sans text-sm text-ink shadow-flyout dark:text-ink-dark dark:shadow-flyout-dark';
const closer = 'size-6 self-start';
const title = 'font-semibold';
const description = 'break-words';
function Glyph({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-badge leading-none font-bold ${tones[tone].icon}`}
    >
      {children}
    </span>
  );
}
const none: Failure[] = [];
const quiet: Notice[] = [];
function recovery(scope: string, failure: Failure, kind: Recovery) {
  const retry = failure.retry;
  if (retry && (failure.retryLabel || kind === 'retry'))
    return {
      label: failure.retryLabel ?? 'Retry',
      again: true,
      run: () => void retry(),
    };
  if (kind === 'pull' && scope !== appScope)
    return {
      label: 'Pull',
      again: false,
      run: () => void perform('sync', { repo: scope, action: 'pull' }),
    };
  return null;
}
function FailureCard({
  scope,
  initial,
  remeasure,
}: {
  scope: string;
  initial: Failure;
  remeasure: () => void;
}) {
  const failure =
    useErrors((s) => s.scopes[scope]?.find((f) => f.id === initial.id)) ??
    initial;
  const dismiss = () => useErrors.getState().dismiss(scope, initial.id);
  const described = describe(failure.error);
  const action = recovery(scope, failure, described.recovery);
  return (
    <div className={`${card} ${tones.critical.card}`}>
      <Glyph tone="critical">!</Glyph>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className={title}>{failure.title ?? described.title}</p>
          <p className={description}>
            {[failure.lead, described.summary].filter(Boolean).join(' ')}
          </p>
        </div>
        <Details
          message={failure.error.message}
          onToggle={remeasure}
          actions={
            action && (
              <Button
                variant="standard"
                onClick={() => {
                  dismiss();
                  action.run();
                }}
              >
                {action.again && <RotateCw className="size-3" />}
                {action.label}
              </Button>
            )
          }
        />
      </div>
      <Button
        variant="icon"
        aria-label="Dismiss error"
        className={closer}
        onClick={dismiss}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
function SuccessCard({ scope, initial }: { scope: string; initial: Notice }) {
  const notice =
    useSuccesses((s) => s.scopes[scope]?.find((n) => n.id === initial.id)) ??
    initial;
  const dismiss = () => useSuccesses.getState().dismiss(scope, initial.id);
  const { restore, unapply, show, info, warning, pending } = notice;
  const tone: Tone = warning ? 'caution' : info ? 'info' : 'success';
  const action = restore
    ? () => perform('stash_restore', { repo: scope, ...restore })
    : unapply
      ? () => unapplyWorktree(scope, unapply)
      : show
        ? () => showWorktree(show)
        : null;
  return (
    <div className={`${card} ${tones[tone].card}`}>
      <Glyph tone={tone}>
        {pending ? (
          <Spinner className="size-2.5" />
        ) : warning ? (
          '!'
        ) : info ? (
          'i'
        ) : (
          <Check className="size-2.5" strokeWidth={3} />
        )}
      </Glyph>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className={title}>{notice.title}</p>
          {notice.description && (
            <p className={description}>{notice.description}</p>
          )}
        </div>
        {action && (
          <div className="flex">
            <Button
              variant="standard"
              onClick={() => {
                dismiss();
                void action();
              }}
            >
              {show ? (
                <>
                  <FolderGit2 className="size-3" />
                  Show main
                </>
              ) : (
                <>
                  <Undo2 className="size-3" />
                  Undo
                </>
              )}
            </Button>
          </div>
        )}
      </div>
      <Button
        variant="icon"
        aria-label="Dismiss"
        className={closer}
        onClick={dismiss}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
export function Toaster() {
  const active = useActiveView();
  const app = useErrors((s) => s.scopes[appScope] ?? none);
  const tab = useErrors((s) => s.scopes[active] ?? none);
  const done = useSuccesses((s) => s.scopes[active] ?? quiet);
  const shown = useRef(new Map<number, string | number>());
  useEffect(() => {
    const entries = [
      ...app.map((failure) => ({ scope: appScope, id: failure.id, failure })),
      ...tab.map((failure) => ({ scope: active, id: failure.id, failure })),
      ...done.map((notice) => ({ scope: active, id: notice.id, notice })),
    ].sort((a, b) => a.id - b.id);
    const current = new Set(entries.map((entry) => entry.id));
    for (const [id, handle] of shown.current)
      if (!current.has(id)) {
        shown.current.delete(id);
        toast.dismiss(handle);
      }
    for (const entry of entries) {
      if (shown.current.has(entry.id)) continue;
      const { scope, id } = entry;
      const release = () => {
        if (!shown.current.delete(id)) return;
        if ('notice' in entry) useSuccesses.getState().dismiss(scope, id);
        else useErrors.getState().dismiss(scope, id);
      };
      const publish = (handle?: string | number): string | number =>
        toast.custom(
          (sonner) =>
            'notice' in entry ? (
              <SuccessCard scope={scope} initial={entry.notice} />
            ) : (
              <FailureCard
                scope={scope}
                initial={entry.failure}
                remeasure={() => {
                  if (shown.current.get(id) === sonner) publish(sonner);
                }}
              />
            ),
          {
            id: handle,
            duration:
              'notice' in entry
                ? entry.notice.pending
                  ? Infinity
                  : entry.notice.restore ||
                      entry.notice.unapply ||
                      entry.notice.show
                    ? 8000
                    : 6000
                : Infinity,
            onAutoClose: release,
            onDismiss: release,
          },
        );
      shown.current.set(id, publish());
    }
  }, [active, app, tab, done]);
  useEffect(() => {
    const handles = shown.current;
    return () => {
      handles.clear();
      toast.dismiss();
    };
  }, []);
  return (
    <Stack
      position="bottom-right"
      offset={{ right: 12, bottom: 36 }}
      gap={8}
      hotkey={['F8']}
      containerAriaLabel="Notifications"
      toastOptions={{ unstyled: true }}
    />
  );
}
