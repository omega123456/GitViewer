import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
export type SidebarMode = 'working' | 'history' | 'compare';
export interface TabLayout {
  mode: SidebarMode;
  width: number;
  historyWidth: number;
  filesHeight: number;
  filesOpen: boolean;
  stashHeight: number;
  stashFilesHeight: number;
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
  stashFilesHeight: 50,
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
export function useSidebarMode(id: string) {
  return useLayout((s) => (s.tabs[id] ?? layoutDefaults).mode);
}
export function useSidebarWidth(id: string) {
  return useLayout((s) => {
    const layout = s.tabs[id] ?? layoutDefaults;
    return layout.mode === 'working' ? layout.width : layout.historyWidth;
  });
}
export function useLayoutFields<K extends keyof TabLayout>(
  id: string,
  ...keys: K[]
) {
  return useLayout(
    useShallow((s) => {
      const layout = s.tabs[id] ?? layoutDefaults;
      return Object.fromEntries(keys.map((key) => [key, layout[key]])) as Pick<
        TabLayout,
        K
      >;
    }),
  );
}
export function tabLayout(id: string) {
  return useLayout.getState().tabs[id] ?? layoutDefaults;
}
