import { create } from 'zustand';
import type { Settings } from '../lib/types';
interface Theme {
  preference: Settings['theme'];
  system: boolean;
  setPreference: (preference: Settings['theme']) => void;
  setSystem: (system: boolean) => void;
}
export const useTheme = create<Theme>((set) => ({
  preference: 'system',
  system: false,
  setPreference: (preference) => set({ preference }),
  setSystem: (system) => set({ system }),
}));
export function useDark() {
  return useTheme(
    (s) => s.preference === 'dark' || (s.preference === 'system' && s.system),
  );
}
