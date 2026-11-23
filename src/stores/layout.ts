import { create } from 'zustand';
import { useTabs } from './tabs';
export type SidebarMode = 'working' | 'history' | 'compare';
export interface TabLayout {
  mode: SidebarMode;
  width: number;
  historyWidth: number;
  blameWidth: number;
  filesHeight: number;
  filesOpen: boolean;
  stashHeight: number;
  stashFilesHeight: number;
  stashOpen: boolean;
  commitMessageHeight: number;
  compareBase: string;
  compareTarget: string;
  mergeBase: boolean;
}
export const layoutDefaults: TabLayout = {
  mode: 'working',
  width: 300,
  historyWidth: 440,
  blameWidth: 480,
  filesHeight: 40,
  filesOpen: false,
  stashHeight: 30,
  stashFilesHeight: 50,
  stashOpen: false,
  commitMessageHeight: 160,
  compareBase: '',
  compareTarget: '',
  mergeBase: true,
};
export interface ResizeBounds {
  min: number;
  max: number;
  step: number;
}
export const sidebarWidthBounds: ResizeBounds = {
  min: 240,
  max: 650,
  step: 10,
};
export const blameWidthBounds: ResizeBounds = { min: 360, max: 640, step: 10 };
export const commitMessageHeightBounds: ResizeBounds = {
  min: 40,
  max: 400,
  step: 10,
};
export const sectionHeightBounds: ResizeBounds = { min: 20, max: 60, step: 2 };
export const stashFilesHeightBounds: ResizeBounds = {
  min: 20,
  max: 80,
  step: 2,
};
const projectWide = ['width', 'historyWidth', 'blameWidth'] as const;
function siblingsOf(id: string) {
  return (
    useTabs.getState().tabs.find((tab) => tab.members.includes(id))
      ?.members ?? [id]
  );
}
export function projectWidths(id: string) {
  const layout = useLayout.getState().tabs[id] ?? layoutDefaults;
  return Object.fromEntries(projectWide.map((key) => [key, layout[key]]));
}
interface Layout {
  tabs: Record<string, TabLayout>;
  update: (id: string, patch: Partial<TabLayout>) => void;
  forget: (id: string) => void;
}
export const useLayout = create<Layout>((set) => ({
  tabs: {},
  update: (id, patch) =>
    set((state) => {
      const shared = Object.fromEntries(
        projectWide.flatMap((key) => (key in patch ? [[key, patch[key]]] : [])),
      );
      const tabs = { ...state.tabs };
      for (const member of siblingsOf(id))
        if (member !== id)
          tabs[member] = { ...layoutDefaults, ...tabs[member], ...shared };
      tabs[id] = { ...layoutDefaults, ...tabs[id], ...patch };
      return { tabs };
    }),
  forget: (id) =>
    set((state) => ({
      tabs: Object.fromEntries(
        Object.entries(state.tabs).filter(([key]) => key !== id),
      ),
    })),
}));
export function useTabLayout(id: string) {
  return useLayout((state) => state.tabs[id] ?? layoutDefaults);
}
export function useSidebarMode(id: string) {
  return useLayout((state) => (state.tabs[id] ?? layoutDefaults).mode);
}
export function useSidebarWidth(id: string) {
  return useLayout((state) => {
    const layout = state.tabs[id] ?? layoutDefaults;
    return layout.mode === 'working' ? layout.width : layout.historyWidth;
  });
}
export function useLayoutField<K extends keyof TabLayout>(id: string, key: K) {
  return useLayout((state) => (state.tabs[id] ?? layoutDefaults)[key]);
}
export function tabLayout(id: string) {
  return useLayout.getState().tabs[id] ?? layoutDefaults;
}
