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
export const projectWide = ['width', 'historyWidth', 'blameWidth'] as const;
export interface LayoutState {
  tabs: Record<string, TabLayout>;
}
export interface LayoutUpdate {
  id: string;
  siblings: string[];
  patch: Partial<TabLayout>;
}
function sharedPart(patch: Partial<TabLayout>): Partial<TabLayout> {
  return Object.fromEntries(
    projectWide.flatMap((key) => (key in patch ? [[key, patch[key]]] : [])),
  );
}
export function updated(state: LayoutState, update: LayoutUpdate): LayoutState {
  const { id, siblings, patch } = update;
  const shared = sharedPart(patch);
  const tabs = { ...state.tabs };
  for (const member of siblings.filter((sibling) => sibling !== id))
    tabs[member] = { ...layoutDefaults, ...tabs[member], ...shared };
  tabs[id] = { ...layoutDefaults, ...tabs[id], ...patch };
  return { tabs: tabs };
}
