import { create } from 'zustand';
import { withEntry, withoutAll } from '../lib/record';
export type CommitMode = 'commit' | 'commitPush';
export interface Tab {
  id: string;
  name: string;
  view: string;
  members: string[];
}
interface Tabs {
  tabs: Tab[];
  active: string;
  recent: string[];
  messages: Record<string, string>;
  modes: Record<string, CommitMode>;
  open: (id: string, name: string, view?: string) => void;
  join: (id: string, name: string, member: string) => void;
  show: (id: string, view: string) => void;
  leave: (id: string, member: string) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  setMessage: (id: string, message: string) => void;
  setCommitMode: (id: string, commitMode: CommitMode) => void;
}
function joined(tabs: Tab[], id: string, name: string, member: string) {
  const tab = tabs.find((candidate) => candidate.id === id);
  if (!tab)
    return [...tabs, { id: id, name: name, view: member, members: [member] }];
  if (tab.members.includes(member)) return tabs;
  return tabs.map((entry) =>
    entry.id === id ? { ...entry, members: [...entry.members, member] } : entry,
  );
}
function touched(recent: string[], id: string) {
  return [id, ...recent.filter((entry) => entry !== id)];
}
export const useTabs = create<Tabs>((set) => ({
  tabs: [],
  active: '',
  recent: [],
  messages: {},
  modes: {},
  open: (id, name, view = id) =>
    set((state) => ({
      active: id,
      recent: touched(state.recent, id),
      tabs: joined(state.tabs, id, name, view).map((tab) =>
        tab.id === id && tab.view !== view ? { ...tab, view } : tab,
      ),
    })),
  join: (id, name, member) =>
    set((state) => ({ tabs: joined(state.tabs, id, name, member) })),
  show: (id, view) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, view } : tab)),
    })),
  leave: (id, member) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id) return tab;
        const members = tab.members.filter((existing) => existing !== member);
        const view =
          tab.view !== member
            ? tab.view
            : members.includes(id)
              ? id
              : members[0];
        return { ...tab, members, view };
      }),
      messages: withoutAll(state.messages, [member]),
    })),
  close: (id) =>
    set((state) => {
      const members = state.tabs.find((tab) => tab.id === id)?.members ?? [];
      return {
        tabs: state.tabs.filter((tab) => tab.id !== id),
        recent: state.recent.filter((entry) => entry !== id),
        active:
          state.active === id
            ? (state.tabs.find((tab) => tab.id !== id)?.id ?? '')
            : state.active,
        messages: withoutAll(state.messages, members),
        modes: withoutAll(state.modes, members),
      };
    }),
  activate: (active) =>
    set((state) => ({ active: active, recent: touched(state.recent, active) })),
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
