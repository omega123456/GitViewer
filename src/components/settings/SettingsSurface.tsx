import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import type { SettingsResponse } from '../../lib/types';
import { usePalette } from '../../stores/palette';
import { useSettingsNav } from '../../stores/settings-nav';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { AiSection } from './AiSection';
import { GeneralSection } from './GeneralSection';
import { SettingsNav } from './SettingsNav';
import { UpdatesSection } from './UpdatesSection';
export function SettingsSurface({ settings }: { settings: SettingsResponse }) {
  const open = usePalette((s) => s.settings);
  const pane = useSettingsNav((s) => s.pane);
  return (
    <Modal
      hideChrome
      size="settings"
      title="Settings"
      open={open}
      onOpenChange={(next) => {
        usePalette.getState().setSettings(next);
        if (!next) useSettingsNav.getState().select('general');
      }}
    >
      <div className="flex h-full">
        <SettingsNav />
        <div className="min-w-0 flex-1 overflow-y-auto px-5 pt-9 pb-5">
          {pane === 'general' && <GeneralSection settings={settings} />}
          {pane === 'ai' && <AiSection settings={settings} />}
          {pane === 'updates' && <UpdatesSection settings={settings} />}
        </div>
      </div>
      <Dialog.Close asChild>
        <Button aria-label="Close dialog" className="absolute top-3 right-3">
          <X className="size-4" />
        </Button>
      </Dialog.Close>
    </Modal>
  );
}
