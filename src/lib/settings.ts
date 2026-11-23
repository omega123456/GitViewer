import { perform, useBackend } from './query';
import type { Settings } from './types';
export const DEFAULT_MAX_FILE_TABS = 8;
export function saveSettings<Current extends Settings>(
  settings: Current,
  patch: Partial<Settings> = {},
) {
  return perform('settings_set', { ...settings, ...patch });
}
export function useSettings() {
  return useBackend('settings_get', {}).data;
}
export function useFileTabLimit() {
  return useSettings()?.maxFileTabs ?? DEFAULT_MAX_FILE_TABS;
}
