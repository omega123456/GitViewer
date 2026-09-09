import { UpdatesSection } from './UpdatesSection';
import type { ReactNode } from 'react';
import { perform } from '../../lib/query';
import type { Settings } from '../../lib/types';
import { usePalette } from '../../stores/palette';
import { Modal } from '../shared/Modal';
import { Segment } from '../shared/Segment';
export function SettingsSurface({ settings }: { settings: Settings }) {
  const open = usePalette((s) => s.settings);
  return (
    <Modal
      title="Settings"
      open={open}
      onOpenChange={usePalette.getState().setSettings}
    >
      <div className="flex max-h-settings overflow-y-auto flex-col">
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
        <UpdatesSection settings={settings} />
      </div>
    </Modal>
  );
}
function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-3 last:border-b-0 dark:border-line-dark">
      <span className="text-xs">
        {title}
        <small className="block text-label text-muted">{description}</small>
      </span>
      <span className="ml-auto">{children}</span>
    </div>
  );
}
