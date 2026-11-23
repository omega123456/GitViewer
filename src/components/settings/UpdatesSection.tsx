import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { perform, useBackend } from '../../lib/query';
import type { Settings } from '../../lib/types';
import { updateBusy, updateStatus } from '../../lib/updates';
import {
  InstallUpdateButton,
  QuitWithoutUpdatingButton,
} from './UpdateActions';
import { saveSettings } from '../../lib/settings';
import { intervalLabels, updateCheckIntervals } from '../../lib/intervals';
import { Info, Power, RefreshCw } from 'lucide-react';
import { Button } from '../shared/Button';
import { Select } from '../shared/Select';
import { Toggle } from '../shared/Toggle';
import { FieldError } from '../states/Errors';
import { SettingCard, SettingGroup, card } from './SettingCard';
import { keysOf } from '../../lib/options';

const updateIntervalLabels = intervalLabels(updateCheckIntervals);
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
                <InstallUpdateButton snapshot={state} className="h-8" />
              </div>
            )}
            {state.canQuitWithoutUpdating && (
              <QuitWithoutUpdatingButton
                snapshot={state}
                className="h-8 self-start"
              />
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
              value={settings.updateCheckInterval}
              options={keysOf(updateCheckIntervals)}
              labels={updateIntervalLabels}
              onChange={(updateCheckInterval) =>
                void saveSettings(settings, { updateCheckInterval })
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
              void saveSettings(settings, { installUpdateOnQuit })
            }
          />
        </SettingCard>
      </SettingGroup>
    </section>
  );
}
