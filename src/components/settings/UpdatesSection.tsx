import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { perform, useBackend } from '../../lib/query';
import type { Settings, UpdateSnapshot } from '../../lib/types';
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
function AvailableUpdateCard({ snapshot }: { snapshot: UpdateSnapshot }) {
  const available = snapshot.available;
  if (!available) return null;
  return (
    <div className={`flex flex-col gap-2 px-4 py-3 ${card}`}>
      <p className="font-semibold">
        GitViewer {available.version} is available
      </p>
      {available.date && (
        <p className="text-muted dark:text-muted-dark">
          Released {format(parseISO(available.date), 'd MMMM yyyy')}
        </p>
      )}
      {available.notes && (
        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
          {available.notes}
        </p>
      )}
      {snapshot.phase === 'downloading' && (
        <progress
          aria-label="Update download"
          className="w-full"
          value={snapshot.total ? snapshot.downloaded : undefined}
          max={snapshot.total ?? undefined}
        />
      )}
      <InstallUpdateButton snapshot={snapshot} className="h-8" />
    </div>
  );
}
function UpdateStatusDetails({ snapshot }: { snapshot: UpdateSnapshot }) {
  const checkDisabled =
    snapshot.availability !== 'enabled' || updateBusy(snapshot);
  const checkedNote = snapshot.lastChecked
    ? ` · Last checked ${formatDistanceToNow(parseISO(snapshot.lastChecked), { addSuffix: true })}`
    : '';
  return (
    <>
      <SettingCard
        icon={<Info className="size-4" />}
        title={`GitViewer ${snapshot.currentVersion}`}
        description={
          <>
            <span role={snapshot.error ? 'alert' : 'status'}>
              {updateStatus(snapshot)}
            </span>
            {checkedNote}
          </>
        }
      >
        <Button
          variant="standard"
          className="h-8"
          disabled={checkDisabled}
          onClick={() => void perform('update_check', {})}
        >
          Check now
        </Button>
      </SettingCard>
      <AvailableUpdateCard snapshot={snapshot} />
      {snapshot.canQuitWithoutUpdating && (
        <QuitWithoutUpdatingButton
          snapshot={snapshot}
          className="h-8 self-start"
        />
      )}
    </>
  );
}
function AutomaticUpdatesGroup({ settings }: { settings: Settings }) {
  return (
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
  );
}
export function UpdatesSection({ settings }: { settings: Settings }) {
  const query = useBackend('update_get', {});
  const state = query.data;
  const loading = !state && !query.error;
  return (
    <section aria-label="Updates" className="flex flex-col gap-4.5 text-sm">
      <SettingGroup title="Software updates">
        {query.error && (
          <FieldError>Could not load the update status.</FieldError>
        )}
        {loading && <p>Loading update status…</p>}
        {state && <UpdateStatusDetails snapshot={state} />}
      </SettingGroup>
      <AutomaticUpdatesGroup settings={settings} />
    </section>
  );
}
