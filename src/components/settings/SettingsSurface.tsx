import { Dialog } from 'radix-ui';
import { Settings as SettingsIcon, X } from 'lucide-react';
import type { SettingsResponse } from '../../lib/types';
import { usePalette } from '../../stores/palette';
import { useSettingsNav } from '../../stores/settings-nav';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { AiSection } from './AiSection';
import { GeneralSection } from './GeneralSection';
import { SettingsNav, panes } from './SettingsNav';
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
        if (!next && document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        usePalette.getState().setSettings(next);
        if (!next) useSettingsNav.getState().select('general');
      }}
    >
      <div className="flex h-full flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2.5 pr-1.5 pl-4 text-label">
          <SettingsIcon className="size-4" />
          Settings
          <Dialog.Close asChild>
            <Button
              variant="icon"
              aria-label="Close dialog"
              className="ml-auto size-8 hover:bg-tab-hover dark:hover:bg-tab-hover-dark"
            >
              <X className="size-4" />
            </Button>
          </Dialog.Close>
        </header>
        <div className="flex min-h-0 flex-1">
          <SettingsNav />
          <div className="min-w-0 flex-1 overflow-y-auto pt-1 pr-7 pb-7 pl-3">
            <div className="mx-auto flex w-full max-w-settings-content flex-col">
              <h2 className="mb-3.5 font-display text-title font-semibold">
                {panes.find((entry) => entry.id === pane)?.label}
              </h2>
              {pane === 'general' && <GeneralSection settings={settings} />}
              {pane === 'ai' && <AiSection settings={settings} />}
              {pane === 'updates' && <UpdatesSection settings={settings} />}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
