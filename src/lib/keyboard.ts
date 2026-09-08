import type { ReactNode } from 'react';
import { platform } from '@tauri-apps/plugin-os';
export interface Action {
  id: string;
  label: string;
  key: string;
  icon?: ReactNode;
  disabled?: boolean;
  run: () => void | Promise<unknown>;
}
export function matches(event: KeyboardEvent, key: string): boolean {
  const parts = key.toLowerCase().split('+');
  const modifier = parts.includes('mod');
  return (
    (platform() === 'macos'
      ? event.metaKey === modifier && !event.ctrlKey
      : event.ctrlKey === modifier && !event.metaKey) &&
    event.shiftKey === parts.includes('shift') &&
    event.altKey === parts.includes('alt') &&
    event.key.toLowerCase() === parts.at(-1)
  );
}
export function runShortcut(event: KeyboardEvent, actions: Action[]) {
  if (event.defaultPrevented) return;
  const editable =
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));
  const action = actions.find(
    (action) =>
      !action.disabled &&
      matches(event, action.key) &&
      (!editable || action.key.includes('Mod')),
  );
  if (action) {
    event.preventDefault();
    void action.run();
  }
}

const glyphs: Record<string, string> = {
  Shift: '⇧',
  Alt: '⌥',
  Enter: '↵',
  Backspace: '⌫',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};
export function shortcutLabel(key: string) {
  return key
    .split('+')
    .map((part) =>
      part === 'Mod'
        ? platform() === 'macos'
          ? '⌘'
          : 'Ctrl'
        : (glyphs[part] ?? part),
    )
    .join('+');
}
