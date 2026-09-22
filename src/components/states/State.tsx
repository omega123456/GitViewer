import type { ComponentType, ReactNode } from 'react';
import { FolderGit2 } from 'lucide-react';
export function State({
  title,
  icon: Icon = FolderGit2,
  tone = 'muted',
  children,
  action,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: 'muted' | 'accent' | 'added' | 'deleted' | 'error';
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    muted: 'text-muted',
    accent: 'text-accent',
    added: 'text-added dark:text-added-dark',
    deleted: 'text-deleted dark:text-deleted-dark',
    error: 'text-error-ink dark:text-error-ink-dark',
  };
  const error = tone === 'error';
  return (
    <div
      role={error ? 'status' : undefined}
      className="flex h-full min-h-32 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      {error ? (
        <span className="mb-1 grid size-11 place-items-center rounded-md bg-error dark:bg-error-dark">
          <Icon className={`size-5 ${tones.error}`} />
        </span>
      ) : (
        <Icon className={`size-7 ${tones[tone]}`} />
      )}
      <h2 className="text-sm font-semibold">{title}</h2>
      {children && (
        <div className="max-w-sm text-xs text-muted">{children}</div>
      )}
      {action}
    </div>
  );
}
