import type { Settings } from './types';
import { useSettings } from './settings';
import { useSystemTheme } from '../stores/theme';
const DEFAULT_THEME: Settings['theme'] = 'system';
const DEFAULT_DENSITY: Settings['density'] = 'comfortable';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
const DARK_CLASS = 'dark';
export function isDark(preference: Settings['theme'], systemDark: boolean) {
  if (preference === 'system') return systemDark;
  return preference === 'dark';
}
export function useDark() {
  const preference = useSettings()?.theme ?? DEFAULT_THEME;
  const systemDark = useSystemTheme((state) => state.dark);
  return isDark(preference, systemDark);
}
export function useCompact() {
  const density = useSettings()?.density ?? DEFAULT_DENSITY;
  return density === 'compact';
}
export function followSystemTheme() {
  const media = window.matchMedia(DARK_SCHEME_QUERY);
  const report = () => useSystemTheme.getState().setDark(media.matches);
  report();
  media.addEventListener('change', report);
  return () => media.removeEventListener('change', report);
}
export function applyDarkClass(dark: boolean) {
  document.documentElement.classList.toggle(DARK_CLASS, dark);
}
