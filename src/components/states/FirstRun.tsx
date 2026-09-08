import { openRepository } from '../../lib/repository';
import { Button } from '../shared/Button';
import { State } from './State';
export function FirstRun() {
  return (
    <div className="min-h-0 flex-1">
      <State
        tone="accent"
        title="No repository open"
        action={
          <Button
            className="mt-1 border border-line dark:border-line-dark"
            onClick={() => void openRepository()}
          >
            Open repository
          </Button>
        }
      >
        Open a folder that contains a Git repository.
      </State>
    </div>
  );
}
