import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { perform, useBackend } from '../../lib/query';
import type { Settings, UpdateSnapshot } from '../../lib/types';
import { Button } from '../shared/Button';
import { focus } from '../shared/styles';

export function updateStatus(state: UpdateSnapshot) {
  if (state.availability === 'development')
    return 'Updates unavailable in development builds';
  if (state.availability === 'unconfigured') return 'Updates not configured';
  switch (state.phase) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return 'Downloading update…';
    case 'ready':
      return 'Update downloaded and verified';
    case 'saving':
      return 'Saving session…';
    case 'installing':
      return 'Installing update…';
    case 'error':
      return state.error;
    case 'available':
      return 'An update is available';
    default:
      return state.lastChecked ? 'Up to date' : 'Not checked yet';
  }
}
export function updateBusy(state: UpdateSnapshot) {
  return ['checking', 'downloading', 'saving', 'installing'].includes(
    state.phase,
  );
}
export function UpdatesSection({ settings }: { settings: Settings }) {
  const query = useBackend('update_get', {});
  const state = query.data;
  return (
    <section
      aria-label="Updates"
      className="mt-4 flex flex-col gap-3 border-t border-line pt-4 text-xs dark:border-line-dark"
    >
      <h2 className="text-sm font-semibold">Updates</h2>
      {query.error && <p role="alert">Couldn’t load update status.</p>}
      {!state && !query.error && <p>Loading update status…</p>}
      {state && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>GitViewer {state.currentVersion}</span>
            <Button
              className="rounded-none"
              disabled={state.availability !== 'enabled' || updateBusy(state)}
              onClick={() => void perform('update_check', {})}
            >
              Check now
            </Button>
          </div>
          <p role={state.error ? 'alert' : 'status'}>{updateStatus(state)}</p>
          {state.lastChecked && (
            <p className="text-muted dark:text-muted-dark">
              Last checked{' '}
              {formatDistanceToNow(parseISO(state.lastChecked), {
                addSuffix: true,
              })}
            </p>
          )}
          {state.available && (
            <div className="flex flex-col gap-2 rounded border border-line p-3 dark:border-line-dark">
              <p className="font-semibold">
                GitViewer {state.available.version} is available
              </p>
              {state.available.date && (
                <p className="text-muted dark:text-muted-dark">
                  Released{' '}
                  {format(parseISO(state.available.date), 'd MMMM yyyy')}
                </p>
              )}
              {state.available.notes && (
                <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                  {state.available.notes}
                </p>
              )}
              {state.phase === 'downloading' && (
                <progress
                  aria-label="Update download"
                  className="w-full"
                  value={state.total ? state.downloaded : undefined}
                  max={state.total ?? undefined}
                />
              )}
              <Button
                className="rounded-none"
                variant="primary"
                disabled={updateBusy(state)}
                onClick={() => void perform('update_install', {})}
              >
                Install and restart
              </Button>
            </div>
          )}
          {state.canQuitWithoutUpdating && (
            <Button
              className="rounded-none"
              disabled={updateBusy(state)}
              onClick={() => void perform('update_quit', {})}
            >
              Quit without updating
            </Button>
          )}
        </>
      )}
      <label className="flex items-center justify-between gap-3">
        Check for updates
        <select
          aria-label="Check for updates"
          value={settings.updateCheckInterval}
          className={`rounded-none border border-line bg-surface p-1 dark:border-line-dark dark:bg-surface-dark ${focus}`}
          onChange={(event) =>
            void perform('settings_set', {
              ...settings,
              updateCheckInterval: event.target
                .value as Settings['updateCheckInterval'],
            })
          }
        >
          <option value="1h">Every hour</option>
          <option value="5h">Every 5 hours</option>
          <option value="1d">Every day</option>
          <option value="7d">Every 7 days</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        Install on quit
        <input
          type="checkbox"
          checked={settings.installUpdateOnQuit}
          onChange={(event) =>
            void perform('settings_set', {
              ...settings,
              installUpdateOnQuit: event.target.checked,
            })
          }
        />
      </label>
      <p className="text-muted dark:text-muted-dark">
        Automatically download updates and apply them when you quit. Your
        session is saved before installation.
      </p>
    </section>
  );
}
