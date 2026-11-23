import {
  Columns2,
  Contrast,
  Download,
  Eye,
  GitCommitHorizontal,
  PanelTop,
  RefreshCw,
  Rows3,
  ZoomIn,
} from 'lucide-react';
import { saveSettings } from '../../lib/settings';
import { fetchIntervals, intervalLabels } from '../../lib/intervals';
import type { Settings } from '../../lib/types';
import { Choice } from '../shared/Choice';
import { Select } from '../shared/Select';
import { Toggle } from '../shared/Toggle';
import { SettingCard, SettingGroup } from './SettingCard';
import { keysOf } from '../../lib/options';
const zoomLevels = ['80%', '90%', '100%', '110%', '125%', '150%'];
const MIN_FILE_TABS = 3;
const MAX_FILE_TABS = 20;
const fileTabLimits = Array.from(
  { length: MAX_FILE_TABS - MIN_FILE_TABS + 1 },
  (_slot, index) => String(index + MIN_FILE_TABS),
);
const icon = 'size-4';
const fetchIntervalLabels = intervalLabels(fetchIntervals);
type SavePatch = (next: Partial<Settings>) => void;
function AppearanceGroup({
  settings,
  save,
}: {
  settings: Settings;
  save: SavePatch;
}) {
  return (
    <SettingGroup title="Appearance">
      <SettingCard
        icon={<Contrast className={icon} />}
        title="Theme"
        description="Follows the system by default"
      >
        <Choice
          label="Theme"
          value={settings.theme}
          options={['light', 'dark', 'system']}
          onChange={(theme) => save({ theme })}
        />
      </SettingCard>
      <SettingCard
        icon={<ZoomIn className={icon} />}
        title="Zoom"
        description="Scales the whole window"
      >
        <span className="block w-40">
          <Select
            label="Zoom"
            placeholder="100%"
            value={`${settings.zoom}%`}
            options={zoomLevels}
            onChange={(level) => save({ zoom: parseInt(level, 10) })}
          />
        </span>
      </SettingCard>
      <SettingCard
        icon={<Rows3 className={icon} />}
        title="Density"
        description="Row height in both trees"
      >
        <Choice
          label="Density"
          value={settings.density}
          options={['compact', 'comfortable']}
          onChange={(density) => save({ density })}
        />
      </SettingCard>
    </SettingGroup>
  );
}
function DiffsGroup({
  settings,
  save,
}: {
  settings: Settings;
  save: SavePatch;
}) {
  return (
    <SettingGroup title="Diffs and files">
      <SettingCard
        icon={<Columns2 className={icon} />}
        title="Default diff mode"
        description="Applied to every newly opened file"
      >
        <Choice
          label="Default diff mode"
          value={settings.diffMode}
          options={['split', 'unified']}
          onChange={(diffMode) => save({ diffMode })}
        />
      </SettingCard>
      <SettingCard
        icon={<PanelTop className={icon} />}
        title="File tabs"
        description="The oldest tab without unsaved edits closes past this"
      >
        <span className="block w-40">
          <Select
            label="File tabs"
            placeholder="8"
            value={String(settings.maxFileTabs)}
            options={fileTabLimits}
            onChange={(limit) => save({ maxFileTabs: parseInt(limit, 10) })}
          />
        </span>
      </SettingCard>
    </SettingGroup>
  );
}
function AutoFetchCard({
  value,
  onChange,
}: {
  value: Settings['autoFetchInterval'];
  onChange: (value: Settings['autoFetchInterval']) => void;
}) {
  return (
    <SettingCard
      icon={<RefreshCw className={icon} />}
      title="Auto fetch"
      description="Fetch every open repository in the background"
    >
      <span className="block w-40">
        <Select
          label="Auto fetch"
          placeholder="Off"
          value={value}
          options={keysOf(fetchIntervals)}
          labels={fetchIntervalLabels}
          onChange={onChange}
        />
      </span>
    </SettingCard>
  );
}
function GitGroup({ settings, save }: { settings: Settings; save: SavePatch }) {
  return (
    <SettingGroup title="Git">
      <SettingCard
        icon={<GitCommitHorizontal className={icon} />}
        title="Commit with nothing staged"
        description="Stage everything and commit, or ask first"
      >
        <Choice
          label="Commit with nothing staged"
          value={settings.smartCommit}
          options={['ask', 'always', 'never']}
          onChange={(smartCommit) => save({ smartCommit })}
        />
      </SettingCard>
      <AutoFetchCard
        value={settings.autoFetchInterval}
        onChange={(autoFetchInterval) => save({ autoFetchInterval })}
      />
      <SettingCard
        icon={<Download className={icon} />}
        title="Pull on checkout"
        description="Pull from the upstream after switching to a tracking branch"
      >
        <Toggle
          label="Pull on checkout"
          checked={settings.pullOnCheckout}
          onChange={(pullOnCheckout) => save({ pullOnCheckout })}
        />
      </SettingCard>
      <SettingCard
        icon={<Eye className={icon} />}
        title="Search ignored files"
        description="Default for the file search in the command palette"
      >
        <Toggle
          label="Search ignored files"
          checked={settings.searchIgnoredFiles}
          onChange={(searchIgnoredFiles) => save({ searchIgnoredFiles })}
        />
      </SettingCard>
    </SettingGroup>
  );
}
export function GeneralSection({ settings }: { settings: Settings }) {
  const save = (next: Partial<Settings>) => void saveSettings(settings, next);
  return (
    <section aria-label="General" className="flex flex-col gap-4.5">
      <AppearanceGroup settings={settings} save={save} />
      <DiffsGroup settings={settings} save={save} />
      <GitGroup settings={settings} save={save} />
    </section>
  );
}
