import { preventBrowserShortcut } from '../lib/browser';
import { useEffect, type ReactNode } from 'react';
import {
  Command,
  FileSearch,
  FolderGit2,
  FolderOpen,
  Settings,
  X,
} from 'lucide-react';
import { registeredActions, useActions } from '../lib/actions';
import { runShortcut, type Action } from '../lib/keyboard';
import { useBackend } from '../lib/query';
import { closeRepository, openRepository } from '../lib/repository';
import { usePalette } from '../stores/palette';
import { activeView, tabById, useTabs } from '../stores/tabs';
interface Availability {
  supported: boolean;
  active: string;
}
function closeActiveRepository(active: string) {
  const tab = tabById(active);
  if (tab) return closeRepository(tab);
}
function appActions({ supported, active }: Availability): Action[] {
  return [
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
      id: 'repositories',
      icon: <FolderGit2 className="size-3.5" />,
      label: 'Go to repository',
      key: 'Shift+F2',
      disabled: !active,
      run: () => usePalette.getState().setOpen(true, 'repositories'),
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
      key: 'Mod+Shift+w',
      disabled: !active,
      run: () => closeActiveRepository(active),
    },
  ];
}
function dialogOpen() {
  return document.querySelector('[role="dialog"]') !== null;
}
function handleAppKey(event: KeyboardEvent) {
  if (!dialogOpen()) runShortcut(event, registeredActions(activeView()));
  preventBrowserShortcut(event);
}
export function CommandProvider({ children }: { children: ReactNode }) {
  const environment = useBackend('env', {});
  const supported = environment.data?.supported ?? false;
  const active = useTabs((state) => state.active);
  useActions('app', appActions({ supported, active }));
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => handleAppKey(event);
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  return <>{children}</>;
}
