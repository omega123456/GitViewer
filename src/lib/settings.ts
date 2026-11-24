import { cachedBackend, perform, useBackendField } from './query';
import type { Settings, SettingsResponse } from './types';
export const DEFAULT_MAX_FILE_TABS = 8;
export function saveSettings<Current extends Settings>(
  settings: Current,
  patch: Partial<Settings> = {},
) {
  return perform('settings_set', { ...settings, ...patch });
}
export function useSetting<Field>(pick: (settings: SettingsResponse) => Field) {
  return useBackendField('settings_get', {}, pick);
}
export function cachedSettings() {
  return cachedBackend('settings_get', {});
}
export function fileTabLimit() {
  return cachedSettings()?.maxFileTabs ?? DEFAULT_MAX_FILE_TABS;
}
