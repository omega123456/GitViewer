import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './Button';
import { CopyButton } from './CopyButton';
export function Details({
  message,
  actions,
  center = false,
  onToggle,
}: {
  message: string;
  actions?: ReactNode;
  center?: boolean;
  onToggle?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const tray = useId();
  return (
    <div className="flex w-full flex-col gap-2">
      <div
        className={`flex items-center gap-1.5 ${center ? 'justify-center' : ''}`}
      >
        <Button
          aria-expanded={open}
          aria-controls={tray}
          className={`text-muted hover:text-ink dark:text-muted-dark dark:hover:text-ink-dark ${center ? '' : '-ml-2'}`}
          onClick={() => {
            setOpen(!open);
            onToggle?.();
          }}
        >
          {open ? 'Hide details' : 'Show details'}
          <ChevronDown
            className={`size-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        </Button>
        {actions && (
          <span className={`flex gap-1.5 ${center ? '' : 'ml-auto'}`}>
            {actions}
          </span>
        )}
      </div>
      {open && (
        <div
          id={tray}
          className="relative rounded bg-sub text-left dark:bg-sub-dark"
        >
          <pre className="max-h-36 overflow-auto py-2.5 pr-9 pl-3 font-mono text-label leading-relaxed whitespace-pre-wrap text-muted select-text dark:text-muted-dark">
            {message}
          </pre>
          <CopyButton
            text={message}
            label="Copy error output"
            className="absolute top-1.5 right-1.5 size-6 text-muted dark:text-muted-dark"
          />
        </div>
      )}
    </div>
  );
}
