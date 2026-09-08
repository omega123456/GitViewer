import { create } from 'zustand';
import type { Settings } from '../lib/types';
interface Density {
  density: Settings['density'];
  setDensity: (density: Settings['density']) => void;
}
export const useDensity = create<Density>((set) => ({
  density: 'comfortable',
  setDensity: (density) => set({ density }),
}));
export function useCompact() {
  return useDensity((s) => s.density === 'compact');
}
