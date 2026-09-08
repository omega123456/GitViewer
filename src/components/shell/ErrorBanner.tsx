import { AlertTriangle, X } from 'lucide-react';
import { useTabs } from '../../stores/tabs';
import { Button } from '../shared/Button';
export function ErrorBanner() {
  const error = useTabs((s) => s.error);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b border-remove-ink bg-remove px-3 py-2 text-xs text-remove-ink dark:bg-remove-dark dark:text-remove-ink-dark"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="max-h-28 flex-1 overflow-auto whitespace-pre-wrap">
        {error.category}: {error.message}
      </span>
      <Button
        aria-label="Dismiss error"
        onClick={() => useTabs.getState().setError(null)}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
