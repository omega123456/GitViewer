import { perform } from '../../lib/query';
import type { UpdateSnapshot } from '../../lib/types';
import { Button } from '../shared/Button';
import { updateBusy } from '../../lib/updates';
export function InstallUpdateButton({
  snapshot,
  className,
}: {
  snapshot: UpdateSnapshot;
  className?: string;
}) {
  return (
    <Button
      variant="primary"
      className={className}
      disabled={updateBusy(snapshot)}
      onClick={() => void perform('update_install', {})}
    >
      Install and restart
    </Button>
  );
}
export function QuitWithoutUpdatingButton({
  snapshot,
  className,
}: {
  snapshot: UpdateSnapshot;
  className?: string;
}) {
  return (
    <Button
      variant="standard"
      className={className}
      disabled={updateBusy(snapshot)}
      onClick={() => void perform('update_quit', {})}
    >
      Quit without updating
    </Button>
  );
}
