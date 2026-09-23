import { create } from 'zustand';
export type CommitMode = 'commit' | 'commitPush';
export interface Tab {
  id: string;
  name: string;
  message: string;
  commitMode: CommitMode;
}
interface Tabs {
  tabs: Tab[];
  active: string;
  open: (id: string, name: string) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  setMessage: (id: string, message: string) => void;
  setCommitMode: (id: string, commitMode: CommitMode) => void;
}
export const useTabs = create<Tabs>((set) => ({
  tabs: [],
  active: '',
  open: (id, name) =>
    set((s) => ({
      active: id,
      tabs: s.tabs.some((t) => t.id === id)
        ? s.tabs
        : [...s.tabs, { id, name, message: '', commitMode: 'commit' }],
    })),
  close: (id) =>
    set((s) => ({
      tabs: s.tabs.filter((t) => t.id !== id),
      active:
        s.active === id
          ? (s.tabs.find((t) => t.id !== id)?.id ?? '')
          : s.active,
    })),
  activate: (active) => set({ active }),
  setMessage: (id, message) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, message } : t)),
    })),
  setCommitMode: (id, commitMode) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, commitMode } : t)),
    })),
}));
export function useMessage(id: string) {
  return useTabs((s) => s.tabs.find((tab) => tab.id === id)?.message ?? '');
}
export function useCommitMode(id: string) {
  return useTabs(
    (s) => s.tabs.find((tab) => tab.id === id)?.commitMode ?? 'commit',
  );
}
