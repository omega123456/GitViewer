import { create } from 'zustand';
interface Filter {
  text: Record<string, string>;
  set: (id: string, value: string) => void;
  forget: (id: string) => void;
}
export const useFilterStore = create<Filter>((set) => ({
  text: {},
  set: (id, value) => set((s) => ({ text: { ...s.text, [id]: value } })),
  forget: (id) =>
    set((s) => ({
      text: Object.fromEntries(
        Object.entries(s.text).filter(([key]) => key !== id),
      ),
    })),
}));
export function useFilter(id: string) {
  return useFilterStore((s) => s.text[id] ?? '');
}
