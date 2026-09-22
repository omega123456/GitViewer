import { create } from 'zustand';
export type SidebarMode = 'working' | 'history' | 'compare';
export interface TabLayout {
  mode: SidebarMode;
  width: number;
  historyWidth: number;
  filesHeight: number;
  filesOpen: boolean;
  stashHeight: number;
  stashOpen: boolean;
  messageHeight: number;
  compareBase: string;
  compareTarget: string;
  mergeBase: boolean;
}
export const layoutDefaults: TabLayout = {
  mode: 'working',
  width: 300,
  historyWidth: 440,
  filesHeight: 40,
  filesOpen: false,
  stashHeight: 30,
  stashOpen: false,
  messageHeight: 80,
  compareBase: '',
  compareTarget: '',
  mergeBase: true,
};
interface Layout {
  tabs: Record<string, TabLayout>;
  update: (id: string, patch: Partial<TabLayout>) => void;
  forget: (id: string) => void;
}
export const useLayout = create<Layout>((set) => ({
  tabs: {},
  update: (id, patch) =>
    set((s) => ({
      tabs: { ...s.tabs, [id]: { ...layoutDefaults, ...s.tabs[id], ...patch } },
    })),
  forget: (id) =>
    set((s) => ({
      tabs: Object.fromEntries(
        Object.entries(s.tabs).filter(([key]) => key !== id),
      ),
    })),
}));
export function useTabLayout(id: string) {
  return useLayout((s) => s.tabs[id] ?? layoutDefaults);
}
export function tabLayout(id: string) {
  return useLayout.getState().tabs[id] ?? layoutDefaults;
}
