import { create } from 'zustand';
import type { GitError } from '../lib/types';
export interface Tab {
  id: string;
  name: string;
  message: string;
}
interface Tabs {
  tabs: Tab[];
  active: string;
  error: GitError | null;
  busy: number;
  open: (id: string, name: string) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  setMessage: (id: string, message: string) => void;
  setError: (error: GitError | null) => void;
  setBusy: (delta: number) => void;
}
export const useTabs = create<Tabs>((set) => ({
  tabs: [],
  active: '',
  error: null,
  busy: 0,
  open: (id, name) =>
    set((s) => ({
      active: id,
      tabs: s.tabs.some((t) => t.id === id)
        ? s.tabs
        : [...s.tabs, { id, name, message: '' }],
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
  setError: (error) => set({ error }),
  setBusy: (delta) => set((s) => ({ busy: Math.max(0, s.busy + delta) })),
}));
export function useMessage(id: string) {
  return useTabs((s) => s.tabs.find((tab) => tab.id === id)?.message ?? '');
}
