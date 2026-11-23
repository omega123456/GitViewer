import { useDeferredValue } from 'react';
import { create } from 'zustand';
import { without, withEntry } from '../lib/record';
interface Filter {
  text: Record<string, string>;
  set: (id: string, value: string) => void;
  forget: (id: string) => void;
}
export const useFilterStore = create<Filter>((set) => ({
  text: {},
  set: (id, value) =>
    set((state) => ({ text: withEntry(state.text, id, value) })),
  forget: (id) => set((state) => ({ text: without(state.text, id) })),
}));
export function useFilter(id: string) {
  return useFilterStore((state) => state.text[id] ?? '');
}
export function useDeferredFilter(id: string) {
  return useDeferredValue(useFilter(id));
}
