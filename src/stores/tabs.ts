import { create } from 'zustand';
import { withEntry } from '../lib/record';
import {
  activated,
  closed,
  cycled,
  joined,
  departed,
  opened,
  shown,
  type CommitMode,
  type Tab,
  type TabsState,
} from './tabs/transitions';
export type { CommitMode, Tab, TabsState } from './tabs/transitions';
interface Tabs extends TabsState {
  open: (id: string, name: string, view?: string) => void;
  join: (id: string, name: string, member: string) => void;
  show: (id: string, view: string) => void;
  leave: (id: string, member: string) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  cycle: (direction: number) => void;
  setMessage: (id: string, message: string) => void;
  setCommitMode: (id: string, commitMode: CommitMode) => void;
}
export const useTabs = create<Tabs>((set) => ({
  tabs: [],
  active: '',
  recent: [],
  messages: {},
  modes: {},
  open: (id, name, view = id) =>
    set((state) => opened(state, { id: id, name: name, member: view })),
  join: (id, name, member) =>
    set((state) => ({
      tabs: joined(state.tabs, { id: id, name: name, member: member }),
    })),
  show: (id, view) => set((state) => shown(state, id, view)),
  leave: (id, member) =>
    set((state) => departed(state, { id: id, member: member })),
  close: (id) => set((state) => closed(state, id)),
  activate: (active) => set((state) => activated(state, active)),
  cycle: (direction) => set((state) => cycled(state, direction)),
  setMessage: (id, message) =>
    set((state) => ({ messages: withEntry(state.messages, id, message) })),
  setCommitMode: (id, commitMode) =>
    set((state) => ({ modes: withEntry(state.modes, id, commitMode) })),
}));
export function useMessage(id: string) {
  return useTabs((state) => state.messages[id] ?? '');
}
export function useHasMessage(id: string) {
  return useTabs((state) => Boolean(state.messages[id]?.trim()));
}
export function tabMessage(id: string) {
  return useTabs.getState().messages[id] ?? '';
}
export function useCommitMode(id: string) {
  return useTabs((state) => state.modes[id] ?? 'commit');
}
type TabSelection = Pick<Tabs, 'tabs' | 'active'>;
function activeTabOf(state: TabSelection) {
  return state.tabs.find((tab) => tab.id === state.active);
}
export function activeTab() {
  return activeTabOf(useTabs.getState());
}
export function useActiveTab() {
  return useTabs(activeTabOf);
}
export function tabById(id: string) {
  return useTabs.getState().tabs.find((tab) => tab.id === id);
}
function projectIn(tabs: Tab[], repo: string) {
  return tabs.find((tab) => tab.members.includes(repo));
}
export function projectOf(repo: string) {
  return projectIn(useTabs.getState().tabs, repo);
}
function viewOf(state: TabSelection) {
  return activeTabOf(state)?.view ?? '';
}
export function activeView() {
  return viewOf(useTabs.getState());
}
export function useActiveView() {
  return useTabs(viewOf);
}
export function useProject(repo: string) {
  return useTabs((state) => projectIn(state.tabs, repo));
}
export function recentTabs({ tabs, recent, active }: Tabs) {
  const rank = (tab: Tab) =>
    tab.id === active
      ? Infinity
      : recent.indexOf(tab.id) + 1 || recent.length + 1;
  return [...tabs].sort((left, right) => rank(left) - rank(right));
}
export function anchorOf(tab: Tab) {
  return tab.members.includes(tab.id) ? tab.id : (tab.members[0] ?? '');
}
