import { stepIndex } from '../../lib/list';
import { withoutAll } from '../../lib/record';
export type CommitMode = 'commit' | 'commitPush';
export interface Tab {
  id: string;
  name: string;
  view: string;
  members: string[];
}
export interface TabsState {
  tabs: Tab[];
  active: string;
  recent: string[];
  messages: Record<string, string>;
  modes: Record<string, CommitMode>;
}
export interface Membership {
  id: string;
  name: string;
  member: string;
}
export interface Departure {
  id: string;
  member: string;
}
export function joined(tabs: Tab[], membership: Membership) {
  const { id, name, member } = membership;
  const tab = tabs.find((candidate) => candidate.id === id);
  if (!tab)
    return [...tabs, { id: id, name: name, view: member, members: [member] }];
  if (tab.members.includes(member)) return tabs;
  return tabs.map((entry) =>
    entry.id === id ? { ...entry, members: [...entry.members, member] } : entry,
  );
}
export function touched(recent: string[], id: string) {
  return [id, ...recent.filter((entry) => entry !== id)];
}
function showing(tab: Tab, view: string) {
  return tab.view === view ? tab : { ...tab, view: view };
}
export function opened(state: TabsState, membership: Membership): TabsState {
  const { id, member: view } = membership;
  return {
    ...state,
    active: id,
    recent: touched(state.recent, id),
    tabs: joined(state.tabs, membership).map((tab) =>
      tab.id === id ? showing(tab, view) : tab,
    ),
  };
}
export function shown(state: TabsState, id: string, view: string): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, view } : tab)),
  };
}
function viewAfterLeaving(tab: Tab, members: string[], member: string) {
  if (tab.view !== member) return tab.view;
  return members.includes(tab.id) ? tab.id : members[0];
}
function withoutMember(tab: Tab, member: string): Tab {
  const members = tab.members.filter((existing) => existing !== member);
  const view = viewAfterLeaving(tab, members, member);
  return { ...tab, members: members, view: view };
}
export function departed(state: TabsState, departure: Departure): TabsState {
  const { id, member } = departure;
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === id ? withoutMember(tab, member) : tab,
    ),
    messages: withoutAll(state.messages, [member]),
  };
}
function activeAfterClosing(state: TabsState, id: string) {
  if (state.active !== id) return state.active;
  return state.tabs.find((tab) => tab.id !== id)?.id ?? '';
}
export function closed(state: TabsState, id: string): TabsState {
  const members = state.tabs.find((tab) => tab.id === id)?.members ?? [];
  return {
    ...state,
    tabs: state.tabs.filter((tab) => tab.id !== id),
    recent: state.recent.filter((entry) => entry !== id),
    active: activeAfterClosing(state, id),
    messages: withoutAll(state.messages, members),
    modes: withoutAll(state.modes, members),
  };
}
export function activated(state: TabsState, id: string): TabsState {
  return { ...state, active: id, recent: touched(state.recent, id) };
}
export function cycled(state: TabsState, direction: number): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === state.active);
  const next = state.tabs[stepIndex(index, direction, state.tabs.length)];
  if (!next) return state;
  return activated(state, next.id);
}
