import { create } from 'zustand';
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
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return [...tabs, { id, name, view: member, members: [member] }];
  if (tab.members.includes(member)) return tabs;
  return tabs.map((t) =>
    t.id === id ? { ...t, members: [...t.members, member] } : t,
  );
}
function without<T>(record: Record<string, T>, keys: string[]) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key)),
  );
}
export const useTabs = create<Tabs>((set) => ({
  tabs: [],
  active: '',
  messages: {},
  modes: {},
  open: (id, name, view = id) =>
    set((s) => ({
      active: id,
      tabs: joined(s.tabs, id, name, view).map((t) =>
        t.id === id && t.view !== view ? { ...t, view } : t,
      ),
    })),
  join: (id, name, member) =>
    set((s) => ({ tabs: joined(s.tabs, id, name, member) })),
  show: (id, view) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, view } : t)),
    })),
  leave: (id, member) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t;
        const members = t.members.filter((m) => m !== member);
        const view =
          t.view !== member ? t.view : members.includes(id) ? id : members[0];
        return { ...t, members, view };
      }),
      messages: without(s.messages, [member]),
    })),
  close: (id) =>
    set((s) => {
      const members = s.tabs.find((t) => t.id === id)?.members ?? [];
      return {
        tabs: s.tabs.filter((t) => t.id !== id),
        active:
          s.active === id
            ? (s.tabs.find((t) => t.id !== id)?.id ?? '')
            : s.active,
        messages: without(s.messages, members),
        modes: without(s.modes, members),
      };
    }),
  activate: (active) => set({ active }),
  setMessage: (id, message) =>
    set((s) => ({ messages: { ...s.messages, [id]: message } })),
  setCommitMode: (id, commitMode) =>
    set((s) => ({ modes: { ...s.modes, [id]: commitMode } })),
}));
export function useMessage(id: string) {
  return useTabs((s) => s.messages[id] ?? '');
}
export function useHasMessage(id: string) {
  return useTabs((s) => Boolean(s.messages[id]?.trim()));
}
export function tabMessage(id: string) {
  return useTabs.getState().messages[id] ?? '';
}
export function useCommitMode(id: string) {
  return useTabs((s) => s.modes[id] ?? 'commit');
}
function viewOf(state: Pick<Tabs, 'tabs' | 'active'>) {
  return state.tabs.find((tab) => tab.id === state.active)?.view ?? '';
}
export function activeView() {
  return viewOf(useTabs.getState());
}
export function useActiveView() {
  return useTabs(viewOf);
}
export function useProject(repo: string) {
  return useTabs((s) => s.tabs.find((tab) => tab.members.includes(repo)));
}
export function anchorOf(tab: Tab) {
  return tab.members.includes(tab.id) ? tab.id : (tab.members[0] ?? '');
}
