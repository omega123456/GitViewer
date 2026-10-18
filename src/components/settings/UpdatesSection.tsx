import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { perform, useBackend } from '../../lib/query';
import type { Settings, UpdateSnapshot } from '../../lib/types';
import { Info, Power, RefreshCw } from 'lucide-react';
import { Button } from '../shared/Button';
import { Select } from '../shared/Select';
import { Toggle } from '../shared/Toggle';
import { FieldError } from '../states/Errors';
import { SettingCard, SettingGroup, card } from './SettingCard';

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
const intervals: Record<Settings['updateCheckInterval'], string> = {
  '1h': 'Every hour',
  '5h': 'Every 5 hours',
  '1d': 'Every day',
  '7d': 'Every 7 days',
  off: 'Off',
};
export function UpdatesSection({ settings }: { settings: Settings }) {
  const query = useBackend('update_get', {});
  const state = query.data;
  return (
    <section aria-label="Updates" className="flex flex-col gap-4.5 text-sm">
      <SettingGroup title="Software updates">
        {query.error && (
          <FieldError>Could not load the update status.</FieldError>
        )}
        {!state && !query.error && <p>Loading update status…</p>}
        {state && (
          <>
            <SettingCard
              icon={<Info className="size-4" />}
              title={`GitViewer ${state.currentVersion}`}
              description={
                <>
                  <span role={state.error ? 'alert' : 'status'}>
                    {updateStatus(state)}
                  </span>
                  {state.lastChecked &&
                    ` · Last checked ${formatDistanceToNow(
                      parseISO(state.lastChecked),
                      { addSuffix: true },
                    )}`}
                </>
              }
            >
              <Button
                variant="standard"
                className="h-8"
                disabled={state.availability !== 'enabled' || updateBusy(state)}
                onClick={() => void perform('update_check', {})}
              >
                Check now
              </Button>
            </SettingCard>
            {state.available && (
              <div className={`flex flex-col gap-2 px-4 py-3 ${card}`}>
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
                  variant="primary"
                  className="h-8"
                  disabled={updateBusy(state)}
                  onClick={() => void perform('update_install', {})}
                >
                  Install and restart
                </Button>
              </div>
            )}
            {state.canQuitWithoutUpdating && (
              <Button
                variant="standard"
                className="h-8 self-start"
                disabled={updateBusy(state)}
                onClick={() => void perform('update_quit', {})}
              >
                Quit without updating
              </Button>
            )}
          </>
        )}
      </SettingGroup>
      <SettingGroup title="Automatic updates">
        <SettingCard
          icon={<RefreshCw className="size-4" />}
          title="Check for updates"
          description="How often GitViewer looks for a newer version"
        >
          <span className="block w-40">
            <Select
              label="Check for updates"
              placeholder="Every day"
              value={intervals[settings.updateCheckInterval]}
              options={Object.values(intervals)}
              onChange={(label) =>
                void perform('settings_set', {
                  ...settings,
                  updateCheckInterval: (
                    Object.keys(intervals) as Settings['updateCheckInterval'][]
                  ).find((key) => intervals[key] === label)!,
                })
              }
            />
          </span>
        </SettingCard>
        <SettingCard
          icon={<Power className="size-4" />}
          title="Install on quit"
          description="Download updates automatically and install them when you quit. Your session is saved first."
        >
          <Toggle
            label="Install on quit"
            checked={settings.installUpdateOnQuit}
            onChange={(installUpdateOnQuit) =>
              void perform('settings_set', {
                ...settings,
                installUpdateOnQuit,
              })
            }
          />
        </SettingCard>
      </SettingGroup>
    </section>
  );
}
