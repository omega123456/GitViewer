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
import { perform } from '../../lib/query';
import type { Settings } from '../../lib/types';
import { Choice } from '../shared/Choice';
import { Select } from '../shared/Select';
import { Toggle } from '../shared/Toggle';
import { SettingCard, SettingGroup } from './SettingCard';
const zoomLevels = [80, 90, 100, 110, 125, 150];
const fileTabLimits = Array.from({ length: 18 }, (_, index) => index + 3);
const icon = 'size-4';
const fetchIntervals: Record<Settings['autoFetchInterval'], string> = {
  off: 'Off',
  '30s': 'Every 30 seconds',
  '1m': 'Every minute',
  '5m': 'Every 5 minutes',
  '10m': 'Every 10 minutes',
  '15m': 'Every 15 minutes',
  '30m': 'Every 30 minutes',
};
export function GeneralSection({ settings }: { settings: Settings }) {
  const save = (next: Partial<Settings>) =>
    void perform('settings_set', { ...settings, ...next });
  return (
    <section aria-label="General" className="flex flex-col gap-4.5">
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
              options={zoomLevels.map((level) => `${level}%`)}
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
              options={fileTabLimits.map(String)}
              onChange={(limit) => save({ maxFileTabs: parseInt(limit, 10) })}
            />
          </span>
        </SettingCard>
      </SettingGroup>
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
        <SettingCard
          icon={<RefreshCw className={icon} />}
          title="Auto fetch"
          description="Fetch every open repository in the background"
        >
          <span className="block w-40">
            <Select
              label="Auto fetch"
              placeholder="Off"
              value={fetchIntervals[settings.autoFetchInterval]}
              options={Object.values(fetchIntervals)}
              onChange={(label) =>
                save({
                  autoFetchInterval: (
                    Object.keys(
                      fetchIntervals,
                    ) as Settings['autoFetchInterval'][]
                  ).find((key) => fetchIntervals[key] === label)!,
                })
              }
            />
          </span>
        </SettingCard>
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
    </section>
  );
}
