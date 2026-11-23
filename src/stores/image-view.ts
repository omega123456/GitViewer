import { create } from 'zustand';
import { isScopeOf } from '../lib/git';
export type ImageMode = 'side by side' | 'swipe' | 'onion skin';
export interface TabImageView {
  mode: ImageMode;
  position: number;
  blend: number;
  zoom: number;
}
export const imageViewDefaults: TabImageView = {
  mode: 'side by side',
  position: 50,
  blend: 50,
  zoom: 0,
};
interface ImageViews {
  tabs: Record<string, TabImageView>;
  update: (id: string, patch: Partial<TabImageView>) => void;
  forget: (id: string) => void;
}
export const useImageViews = create<ImageViews>((set) => ({
  tabs: {},
  update: (id, patch) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [id]: { ...imageViewDefaults, ...state.tabs[id], ...patch },
      },
    })),
  forget: (id) =>
    set((state) => ({
      tabs: Object.fromEntries(
        Object.entries(state.tabs).filter(
          ([key]) => key !== id && !isScopeOf(key, id),
        ),
      ),
    })),
}));
export function useTabImageView(id: string) {
  return useImageViews((state) => state.tabs[id] ?? imageViewDefaults);
}
