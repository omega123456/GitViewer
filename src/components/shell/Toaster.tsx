import { Toast } from 'radix-ui';
import { AlertTriangle, Lock, RotateCw, WifiOff, X } from 'lucide-react';
import { describe, type Recovery } from '../../lib/failure';
import { perform } from '../../lib/query';
import { appScope, useErrors, type Failure } from '../../stores/errors';
import { useTabs } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Details } from '../shared/Details';
const icons = { network: WifiOff, authentication: Lock, alert: AlertTriangle };
const tucked =
  'pointer-events-none max-h-24 overflow-hidden group-hover:pointer-events-auto group-hover:max-h-none group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:max-h-none group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100';
const depths = [
  'z-10',
  `-translate-y-3 scale-95 opacity-75 ${tucked}`,
  `-translate-y-6 scale-90 opacity-50 ${tucked}`,
];
const none: Failure[] = [];
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
  failure,
  depth,
}: {
  scope: string;
  failure: Failure;
  depth: number;
}) {
  const described = describe(failure.error);
  const Icon = icons[described.kind];
  const action = recovery(scope, failure, described.recovery);
  return (
    <Toast.Root
      open
      type="foreground"
      onOpenChange={(open) => {
        if (!open) useErrors.getState().dismiss(scope, failure.id);
      }}
      className={`col-start-1 row-start-1 flex origin-top gap-2.5 self-end group-hover:row-start-auto group-focus-within:row-start-auto rounded-md border border-line bg-surface p-3 text-ink shadow-lg transition motion-safe:animate-rise motion-reduce:transition-none dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark ${depths[depth]}`}
    >
      <span className="grid size-6.5 shrink-0 place-items-center rounded bg-error text-error-ink dark:bg-error-dark dark:text-error-ink-dark">
        <Icon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5 pr-1">
          <Toast.Title className="text-sm font-semibold">
            {failure.title ?? described.title}
          </Toast.Title>
          <Toast.Description className="text-xs break-words text-muted dark:text-muted-dark">
            {[failure.lead, described.summary].filter(Boolean).join(' ')}
          </Toast.Description>
        </div>
        <Details
          message={failure.error.message}
          actions={
            action && (
              <Toast.Action asChild altText={action.label}>
                <Button
                  className="border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
                  onClick={action.run}
                >
                  {action.again && <RotateCw className="size-3" />}
                  {action.label}
                </Button>
              </Toast.Action>
            )
          }
        />
      </div>
      <Toast.Close asChild>
        <Button
          variant="icon"
          aria-label="Dismiss error"
          className="size-6 self-start text-faint hover:text-ink dark:text-faint-dark dark:hover:text-ink-dark"
        >
          <X className="size-3.5" />
        </Button>
      </Toast.Close>
    </Toast.Root>
  );
}
export function Toaster() {
  const active = useTabs((s) => s.active);
  const app = useErrors((s) => s.scopes[appScope] ?? none);
  const tab = useErrors((s) => s.scopes[active] ?? none);
  const entries = [
    ...app.map((failure) => ({ scope: appScope, failure })),
    ...tab.map((failure) => ({ scope: active, failure })),
  ]
    .sort((a, b) => a.failure.id - b.failure.id)
    .slice(-depths.length);
  return (
    <Toast.Provider duration={Infinity} label="Error">
      {entries.map(({ scope, failure }, index) => (
        <FailureCard
          key={failure.id}
          scope={scope}
          failure={failure}
          depth={entries.length - 1 - index}
        />
      ))}
      <Toast.Viewport
        label="Errors ({hotkey})"
        className="group absolute right-3 bottom-9 z-30 grid w-toast max-w-full gap-2 outline-none"
      />
    </Toast.Provider>
  );
}
