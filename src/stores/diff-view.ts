import { create } from 'zustand';
import type { Settings } from '../lib/types';
interface DiffView {
  mode: Settings['diffMode'] | null;
  setMode: (mode: Settings['diffMode']) => void;
}
export const useDiffView = create<DiffView>((set) => ({
  mode: null,
  setMode: (mode) => set({ mode }),
}));
