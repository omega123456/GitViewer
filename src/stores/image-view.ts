import { create } from 'zustand';
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
    set((s) => ({
      tabs: {
        ...s.tabs,
        [id]: { ...imageViewDefaults, ...s.tabs[id], ...patch },
      },
    })),
  forget: (id) =>
    set((s) => ({
      tabs: Object.fromEntries(
        Object.entries(s.tabs).filter(
          ([key]) => key !== id && !key.startsWith(`${id}:`),
        ),
      ),
    })),
}));
export function useTabImageView(id: string) {
  return useImageViews((s) => s.tabs[id] ?? imageViewDefaults);
}
