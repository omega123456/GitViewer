import { create } from 'zustand';
export type PaletteMode = 'commands' | 'files';
interface Palette {
  open: boolean;
  mode: PaletteMode;
  settings: boolean;
  setOpen: (open: boolean, mode?: PaletteMode) => void;
  setSettings: (settings: boolean) => void;
}
export const usePalette = create<Palette>((set) => ({
  open: false,
  mode: 'commands',
  settings: false,
  setOpen: (open, mode = 'commands') => set({ open, mode }),
  setSettings: (settings) => set({ settings }),
}));
