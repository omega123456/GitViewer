import { AlertTriangle } from 'lucide-react';
import type { Environment } from '../../lib/types';
import { State } from './State';
export function MissingGit({
  environment,
  error,
}: {
  environment?: Environment;
  error: { message: string } | null;
}) {
  return (
    <main className="h-screen border-2 border-deleted bg-surface text-ink dark:border-deleted-dark dark:bg-surface-dark dark:text-ink-dark">
      <State
        icon={AlertTriangle}
        tone="deleted"
        title={
          environment?.found ? 'Git needs an update' : 'Git is not installed'
        }
      >
        <p>
          Git 2.38 or newer is required.{' '}
          {environment?.version && `Detected ${environment.version}.`}
        </p>
        <p className="mt-3">
          macOS: install Command Line Tools using{' '}
          <code>xcode-select --install</code>.
        </p>
        <p className="mt-2">
          Windows: install Git for Windows from git-scm.com, then restart
          GitViewer.
        </p>
        {error && <p>{error.message}</p>}
      </State>
    </main>
  );
}
