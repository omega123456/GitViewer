import { create } from 'zustand';
interface Palette {
  open: boolean;
  settings: boolean;
  setOpen: (open: boolean) => void;
  setSettings: (settings: boolean) => void;
}
export const usePalette = create<Palette>((set) => ({
  open: false,
  settings: false,
  setOpen: (open) => set({ open }),
  setSettings: (settings) => set({ settings }),
}));
