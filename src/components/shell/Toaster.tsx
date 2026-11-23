import { useEffect, useRef } from 'react';
import { Toaster as Stack, toast } from 'sonner';
import type { ReactNode } from 'react';
import { Check, FolderGit2, RotateCw, Undo2, X } from 'lucide-react';
import { describe, type Recovery } from '../../lib/failure';
import { perform } from '../../lib/query';
import { pull } from '../../lib/pull';
import { showWorktree } from '../../lib/repository';
import { unapplyWorktree } from '../../lib/worktree';
import { appScope, useErrors, type Failure } from '../../stores/errors';
import { useSuccesses, type Notice } from '../../stores/successes';
import { useActiveView } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Details } from '../shared/Details';
import { Spinner } from '../shared/Spinner';
import {
  diffNotices,
  toastDuration,
  toastEntries,
  type ToastEntry,
} from './toast-notices';
type ToastHandle = string | number;
type ShownToasts = Map<number, ToastHandle>;
function release(shown: ShownToasts, entry: ToastEntry) {
  const { scope, id } = entry;
  if (!shown.delete(id)) return;
  if ('notice' in entry) useSuccesses.getState().dismiss(scope, id);
  else useErrors.getState().dismiss(scope, id);
}
function publish(
  shown: ShownToasts,
  entry: ToastEntry,
  handle?: ToastHandle,
): ToastHandle {
  const { scope, id } = entry;
  const close = () => release(shown, entry);
  return toast.custom(
    (sonner) =>
      'notice' in entry ? (
        <SuccessCard scope={scope} initial={entry.notice} />
      ) : (
        <FailureCard
          scope={scope}
          initial={entry.failure}
          remeasure={() => {
            if (shown.get(id) === sonner) publish(shown, entry, sonner);
          }}
        />
      ),
    {
      id: handle,
      duration: toastDuration(entry),
      onAutoClose: close,
      onDismiss: close,
    },
  );
}
function dismissShown(shown: ShownToasts, id: number) {
  const handle = shown.get(id);
  shown.delete(id);
  toast.dismiss(handle);
}
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
function NoticeCard({
  tone,
  glyph,
  heading,
  text,
  dismissLabel,
  onDismiss,
  children,
}: {
  tone: Tone;
  glyph: ReactNode;
  heading: string;
  text?: string;
  dismissLabel: string;
  onDismiss: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`${card} ${tones[tone].card}`}>
      <Glyph tone={tone}>{glyph}</Glyph>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className={title}>{heading}</p>
          {text !== undefined && <p className={description}>{text}</p>}
        </div>
        {children}
      </div>
      <Button
        variant="icon"
        aria-label={dismissLabel}
        className={closer}
        onClick={onDismiss}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
const none: Failure[] = [];
const quiet: Notice[] = [];
function recovery(scope: string, failure: Failure, kind: Recovery) {
  const pullable = kind === 'pull' && scope !== appScope;
  if (pullable)
    return {
      label: 'Pull',
      again: false,
      run: () => void pull(scope),
    };
  const retry = failure.retry;
  if (retry && (failure.retryLabel || kind === 'retry'))
    return {
      label: failure.retryLabel ?? 'Retry',
      again: true,
      run: () => void retry(),
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
    useErrors((state) =>
      state.scopes[scope]?.find((failure) => failure.id === initial.id),
    ) ?? initial;
  const dismiss = () => useErrors.getState().dismiss(scope, initial.id);
  const described = describe(failure.error);
  const action = recovery(scope, failure, described.recovery);
  return (
    <NoticeCard
      tone="critical"
      glyph="!"
      heading={failure.title ?? described.title}
      text={[failure.lead, described.summary].filter(Boolean).join(' ')}
      dismissLabel="Dismiss error"
      onDismiss={dismiss}
    >
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
    </NoticeCard>
  );
}
function SuccessCard({ scope, initial }: { scope: string; initial: Notice }) {
  const notice =
    useSuccesses((state) =>
      state.scopes[scope]?.find((notice) => notice.id === initial.id),
    ) ?? initial;
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
    <NoticeCard
      tone={tone}
      glyph={
        pending ? (
          <Spinner className="size-2.5" />
        ) : warning ? (
          '!'
        ) : info ? (
          'i'
        ) : (
          <Check className="size-2.5" strokeWidth={3} />
        )
      }
      heading={notice.title}
      text={notice.description || undefined}
      dismissLabel="Dismiss"
      onDismiss={dismiss}
    >
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
    </NoticeCard>
  );
}
export function Toaster() {
  const active = useActiveView();
  const app = useErrors((state) => state.scopes[appScope] ?? none);
  const tab = useErrors((state) => state.scopes[active] ?? none);
  const done = useSuccesses((state) => state.scopes[active] ?? quiet);
  const shown = useRef<ShownToasts>(new Map());
  useEffect(() => {
    const entries = toastEntries({
      active: active,
      app: app,
      tab: tab,
      done: done,
    });
    const changes = diffNotices(shown.current.keys(), entries);
    for (const id of changes.removed) dismissShown(shown.current, id);
    for (const entry of changes.added)
      shown.current.set(entry.id, publish(shown.current, entry));
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
