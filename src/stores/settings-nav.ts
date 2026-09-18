import { create } from 'zustand';
export type SettingsPane = 'general' | 'ai' | 'updates';
interface SettingsNav {
  pane: SettingsPane;
  select: (pane: SettingsPane) => void;
}
export const useSettingsNav = create<SettingsNav>((set) => ({
  pane: 'general',
  select: (pane) => set({ pane }),
}));
