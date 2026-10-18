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
            variant="standard"
            className="mt-1"
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
