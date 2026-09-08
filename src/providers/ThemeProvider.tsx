import { useEffect, type ReactNode } from 'react';
import { useBackend } from '../lib/query';
import { useDensity } from '../stores/density';
import { useDark, useTheme } from '../stores/theme';
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preferences = useBackend('settings_get', {});
  const theme = preferences.data?.theme;
  const density = preferences.data?.density;
  const dark = useDark();
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => useTheme.getState().setSystem(media.matches);
    handler();
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);
  useEffect(() => {
    if (theme) useTheme.getState().setPreference(theme);
  }, [theme]);
  useEffect(() => {
    if (density) useDensity.getState().setDensity(density);
  }, [density]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return <>{children}</>;
}
