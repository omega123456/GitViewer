import { perform, useBackend } from '../../lib/query';
import { useUpdate } from '../../stores/update';
import { Button } from '../shared/Button';
import { updateBusy, updateStatus } from '../settings/UpdatesSection';
export function UpdateBanner() {
  const { data: state } = useBackend('update_get', {});
  const dismissed = useUpdate((s) => s.dismissedVersion);
  if (
    !state?.available ||
    (dismissed === state.available.version && !state.canQuitWithoutUpdating)
  )
    return null;
  return (
    <aside
      aria-label="Application update"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-sub px-3 py-2 text-xs dark:border-line-dark dark:bg-sub-dark"
    >
      <span>GitViewer {state.available.version} is available</span>
      <span role="status" className="text-muted dark:text-muted-dark">
        {updateStatus(state)}
      </span>
      <Button
        className="rounded-none"
        variant="primary"
        disabled={updateBusy(state)}
        onClick={() => void perform('update_install', {})}
      >
        Install and restart
      </Button>
      {state.canQuitWithoutUpdating && (
        <Button
          className="rounded-none"
          disabled={updateBusy(state)}
          onClick={() => void perform('update_quit', {})}
        >
          Quit without updating
        </Button>
      )}
      <Button
        className="rounded-none"
        aria-label="Dismiss update"
        onClick={() => useUpdate.getState().dismiss(state.available!.version)}
      >
        Later
      </Button>
    </aside>
  );
}
