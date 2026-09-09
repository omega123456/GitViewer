import { create } from 'zustand';
export const useUpdate = create<{
  dismissedVersion: string | null;
  dismiss: (version: string) => void;
}>((set) => ({
  dismissedVersion: null,
  dismiss: (dismissedVersion) => set({ dismissedVersion }),
}));
