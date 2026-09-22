import type { ReactNode } from 'react';
import { AlertTriangle, CircleX, RotateCw } from 'lucide-react';
import { summarize } from '../../lib/failure';
import { Button } from '../shared/Button';
import { Details } from '../shared/Details';
import { State } from './State';
export function ErrorState({
  title,
  error,
  retry,
  action,
}: {
  title: string;
  error: { message: string };
  retry?: () => void;
  action?: ReactNode;
}) {
  return (
    <State
      tone="error"
      icon={AlertTriangle}
      title={title}
      action={
        <div className="mt-1 w-full max-w-md">
          <Details
            center
            message={error.message}
            actions={
              (retry || action) && (
                <>
                  {retry && (
                    <Button
                      className="border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
                      onClick={retry}
                    >
                      <RotateCw className="size-3" />
                      Retry
                    </Button>
                  )}
                  {action}
                </>
              )
            }
          />
        </div>
      }
    >
      {summarize(error.message)}
    </State>
  );
}
export function ErrorRow({
  label,
  error,
  retry,
}: {
  label: string;
  error: { message: string };
  retry?: () => void;
}) {
  return (
    <p
      role="status"
      title={error.message}
      className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-muted dark:text-muted-dark"
    >
      <AlertTriangle className="size-3 shrink-0 text-error-ink dark:text-error-ink-dark" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {retry && (
        <Button
          className="px-1 py-0 font-medium text-accent dark:text-accent-dark"
          onClick={retry}
        >
          Retry
        </Button>
      )}
    </p>
  );
}
export function FieldError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-1.5 text-label text-error-ink dark:text-error-ink-dark"
    >
      <CircleX className="size-3 shrink-0" />
      {children}
    </p>
  );
}
