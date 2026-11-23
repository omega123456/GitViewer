import { create } from 'zustand';
import { without } from '../lib/record';
import { projectOf } from './tabs';
import {
  layoutDefaults,
  projectWide,
  updated,
  type LayoutState,
  type TabLayout,
} from './layout/transitions';
export type { SidebarMode, TabLayout } from './layout/transitions';
export { layoutDefaults } from './layout/transitions';
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
function siblingsOf(id: string) {
  return projectOf(id)?.members ?? [id];
}
export function projectWidths(id: string) {
  const layout = useLayout.getState().tabs[id] ?? layoutDefaults;
  return Object.fromEntries(projectWide.map((key) => [key, layout[key]]));
}
interface Layout extends LayoutState {
  update: (id: string, patch: Partial<TabLayout>) => void;
  forget: (id: string) => void;
}
export const useLayout = create<Layout>((set) => ({
  tabs: {},
  update: (id, patch) =>
    set((state) =>
      updated(state, { id: id, siblings: siblingsOf(id), patch: patch }),
    ),
  forget: (id) => set((state) => ({ tabs: without(state.tabs, id) })),
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
