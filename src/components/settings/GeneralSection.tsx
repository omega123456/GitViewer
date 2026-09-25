import type { ReactNode } from 'react';
import { perform } from '../../lib/query';
import type { Settings } from '../../lib/types';
import { Segment } from '../shared/Segment';
import { Select } from '../shared/Select';
const zoomLevels = [80, 90, 100, 110, 125, 150];
const fileTabLimits = Array.from({ length: 18 }, (_, index) => index + 3);
export function SettingRow({
  title,
  description,
  stack,
  children,
}: {
  title: string;
  description: string;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex gap-3 border-b border-line py-3 last:border-b-0 dark:border-line-dark ${stack ? 'flex-col items-stretch' : 'items-center'}`}
    >
      <span className="text-xs">
        {title}
        <small className="block text-label text-muted">{description}</small>
      </span>
      <span className={stack ? 'flex flex-col gap-2' : 'ml-auto'}>
        {children}
      </span>
    </div>
  );
}
export function GeneralSection({ settings }: { settings: Settings }) {
  return (
    <section aria-label="General" className="flex flex-col">
      <SettingRow title="Theme" description="Follows the system by default">
        <Segment
          label="Theme"
          value={settings.theme}
          options={['light', 'dark', 'system']}
          onChange={(theme) =>
            void perform('settings_set', { ...settings, theme })
          }
        />
      </SettingRow>
      <SettingRow title="Zoom" description="Scales the whole window">
        <span className="block w-24">
          <Select
            label="Zoom"
            placeholder="100%"
            value={`${settings.zoom}%`}
            options={zoomLevels.map((level) => `${level}%`)}
            onChange={(level) =>
              void perform('settings_set', {
                ...settings,
                zoom: parseInt(level, 10),
              })
            }
          />
        </span>
      </SettingRow>
      <SettingRow title="Density" description="Row height in both trees">
        <Segment
          label="Density"
          value={settings.density}
          options={['compact', 'comfortable']}
          onChange={(density) =>
            void perform('settings_set', { ...settings, density })
          }
        />
      </SettingRow>
      <SettingRow
        title="Default diff mode"
        description="Applied to every newly opened file"
      >
        <Segment
          label="Default diff mode"
          value={settings.diffMode}
          options={['split', 'unified']}
          onChange={(diffMode) =>
            void perform('settings_set', { ...settings, diffMode })
          }
        />
      </SettingRow>
      <SettingRow
        title="File tabs"
        description="The oldest tab without unsaved edits closes past this"
      >
        <span className="block w-24">
          <Select
            label="File tabs"
            placeholder="8"
            value={String(settings.maxFileTabs)}
            options={fileTabLimits.map(String)}
            onChange={(limit) =>
              void perform('settings_set', {
                ...settings,
                maxFileTabs: parseInt(limit, 10),
              })
            }
          />
        </span>
      </SettingRow>
      <SettingRow
        title="Commit with nothing staged"
        description="Stage everything and commit, or ask first"
      >
        <Segment
          label="Commit with nothing staged"
          value={settings.smartCommit}
          options={['ask', 'always', 'never']}
          onChange={(smartCommit) =>
            void perform('settings_set', { ...settings, smartCommit })
          }
        />
      </SettingRow>
      <SettingRow
        title="Search ignored files"
        description="Default for the file search in the command palette"
      >
        <input
          type="checkbox"
          aria-label="Search ignored files"
          checked={settings.searchIgnoredFiles}
          onChange={(event) =>
            void perform('settings_set', {
              ...settings,
              searchIgnoredFiles: event.target.checked,
            })
          }
        />
      </SettingRow>
    </section>
  );
}
