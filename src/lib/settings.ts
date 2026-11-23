import { perform } from './query';
import type { Settings } from './types';
export function saveSettings<Current extends Settings>(
  settings: Current,
  patch: Partial<Settings> = {},
) {
  return perform('settings_set', { ...settings, ...patch });
}
