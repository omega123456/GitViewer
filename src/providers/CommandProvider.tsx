import { preventBrowserShortcut } from '../lib/browser';
import { useEffect, type ReactNode } from 'react';
import { Command, FileSearch, FolderOpen, Settings, X } from 'lucide-react';
import { registeredActions, useActions } from '../lib/actions';
import { runShortcut } from '../lib/keyboard';
import { useBackend } from '../lib/query';
import { closeRepository, openRepository } from '../lib/repository';
import { usePalette } from '../stores/palette';
import { useTabs } from '../stores/tabs';
export function CommandProvider({ children }: { children: ReactNode }) {
  const environment = useBackend('env', {});
  const supported = environment.data?.supported ?? false;
  const active = useTabs((s) => s.active);
  useActions('app', [
    {
      id: 'open',
      icon: <FolderOpen className="size-3.5" />,
      label: 'Open repository',
      key: 'Mod+o',
      disabled: !supported,
      run: openRepository,
    },
    {
      id: 'palette',
      icon: <Command className="size-3.5" />,
      label: 'Command palette',
      key: 'Mod+Shift+p',
      disabled: !supported,
      run: () => usePalette.getState().setOpen(true),
    },
    {
      id: 'files',
      icon: <FileSearch className="size-3.5" />,
      label: 'Go to file',
      key: 'F2',
      disabled: !active,
      run: () => usePalette.getState().setOpen(true, 'files'),
    },
    {
      id: 'settings',
      icon: <Settings className="size-3.5" />,
      label: 'Settings',
      key: 'Mod+,',
      disabled: !supported,
      run: () => usePalette.getState().setSettings(true),
    },
    {
      id: 'close-repository',
      icon: <X className="size-3.5" />,
      label: 'Close repository',
      key: 'Mod+w',
      disabled: !active,
      run: () => {
        const tab = useTabs.getState().tabs.find((tab) => tab.id === active);
        if (tab) return closeRepository(tab);
      },
    },
  ]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!document.querySelector('[role="dialog"]'))
        runShortcut(event, registeredActions(useTabs.getState().active));
      preventBrowserShortcut(event);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  return <>{children}</>;
}
