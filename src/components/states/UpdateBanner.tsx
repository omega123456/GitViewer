import { useBackend } from '../../lib/query';
import { useUpdate } from '../../stores/update';
import { Button } from '../shared/Button';
import { updateStatus } from '../../lib/updates';
import {
  InstallUpdateButton,
  QuitWithoutUpdatingButton,
} from '../settings/UpdateActions';
export function UpdateBanner() {
  const { data: snapshot } = useBackend('update_get', {});
  const dismissed = useUpdate((state) => state.dismissedVersion);
  if (
    !snapshot?.available ||
    (dismissed === snapshot.available.version &&
      !snapshot.canQuitWithoutUpdating)
  )
    return null;
  const available = snapshot.available;
  return (
    <aside
      aria-label="Application update"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-sub px-3 py-2 text-sm dark:border-line-dark dark:bg-sub-dark"
    >
      <span>GitViewer {snapshot.available.version} is available</span>
      <span role="status" className="text-muted dark:text-muted-dark">
        {updateStatus(snapshot)}
      </span>
      <InstallUpdateButton snapshot={snapshot} />
      {snapshot.canQuitWithoutUpdating && (
        <QuitWithoutUpdatingButton snapshot={snapshot} />
      )}
      <Button
        aria-label="Dismiss update"
        onClick={() => useUpdate.getState().dismiss(available.version)}
      >
        Later
      </Button>
    </aside>
  );
}
