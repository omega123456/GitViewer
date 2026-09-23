import { useEffect, useRef } from 'react';
import { Toaster as Stack, toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Lock,
  RotateCw,
  Undo2,
  WifiOff,
  X,
} from 'lucide-react';
import { describe, type Recovery } from '../../lib/failure';
import { perform } from '../../lib/query';
import { appScope, useErrors, type Failure } from '../../stores/errors';
import { useSuccesses, type Notice } from '../../stores/successes';
import { useTabs } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Details } from '../shared/Details';
const icons = { network: WifiOff, authentication: Lock, alert: AlertTriangle };
const card =
  'flex w-toast gap-2.5 rounded-md font-sans border border-line bg-surface p-3 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';
const bordered =
  'border border-line bg-surface dark:border-line-dark dark:bg-surface-dark';
const closer =
  'size-6 self-start text-faint hover:text-ink dark:text-faint-dark dark:hover:text-ink-dark';
const title = 'text-sm font-semibold';
const description = 'text-xs break-words text-muted dark:text-muted-dark';
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
  const Icon = icons[described.kind];
  const action = recovery(scope, failure, described.recovery);
  return (
    <div className={card}>
      <span className="grid size-6.5 shrink-0 place-items-center rounded bg-error text-error-ink dark:bg-error-dark dark:text-error-ink-dark">
        <Icon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5 pr-1">
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
                className={bordered}
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
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
function SuccessCard({ scope, initial }: { scope: string; initial: Notice }) {
  const notice =
    useSuccesses((s) => s.scopes[scope]?.find((n) => n.id === initial.id)) ??
    initial;
  const dismiss = () => useSuccesses.getState().dismiss(scope, initial.id);
  const { restore } = notice;
  return (
    <div className={card}>
      <span className="grid size-6.5 shrink-0 place-items-center rounded border border-line bg-chrome dark:border-line-dark dark:bg-chrome-dark">
        <Check className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5 pr-1">
          <p className={title}>{notice.title}</p>
          {notice.description && (
            <p className={description}>{notice.description}</p>
          )}
        </div>
        {restore && (
          <div className="flex">
            <Button
              className={bordered}
              onClick={() => {
                dismiss();
                void perform('stash_restore', { repo: scope, ...restore });
              }}
            >
              <Undo2 className="size-3" />
              Undo
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
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
export function Toaster() {
  const active = useTabs((s) => s.active);
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
                ? entry.notice.restore
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
