import { create } from 'zustand';
export interface TabLayout {
  history: boolean;
  width: number;
  historyWidth: number;
  changesHeight: number;
}
export const layoutDefaults: TabLayout = {
  history: false,
  width: 300,
  historyWidth: 440,
  changesHeight: 38,
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
