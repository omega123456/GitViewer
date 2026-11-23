import { create } from 'zustand';
interface SystemTheme {
  dark: boolean;
  setDark: (dark: boolean) => void;
}
export const useSystemTheme = create<SystemTheme>((set) => ({
  dark: false,
  setDark: (dark) => set({ dark }),
}));
