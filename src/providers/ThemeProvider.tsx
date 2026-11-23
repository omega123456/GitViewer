import { useEffect, type ReactNode } from 'react';
import { applyDarkClass, followSystemTheme, useDark } from '../lib/theme';
export function ThemeProvider({ children }: { children: ReactNode }) {
  const dark = useDark();
  useEffect(followSystemTheme, []);
  useEffect(() => applyDarkClass(dark), [dark]);
  return <>{children}</>;
}
