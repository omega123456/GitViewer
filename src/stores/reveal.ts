import { create } from 'zustand';
export interface RevealTarget {
  tree: string;
  path: string;
}
interface Reveal {
  targets: Record<string, RevealTarget | undefined>;
  request: (id: string, target: RevealTarget) => void;
  finish: (id: string, target: RevealTarget) => void;
}
export const useReveal = create<Reveal>((set) => ({
  targets: {},
  request: (id, target) =>
    set((state) => ({ targets: { ...state.targets, [id]: { ...target } } })),
  finish: (id, target) =>
    set((state) =>
      state.targets[id] === target
        ? { targets: { ...state.targets, [id]: undefined } }
        : state,
    ),
}));
export function useRevealTarget(id: string, tree: string) {
  return useReveal((state) => {
    const target = state.targets[id];
    return target?.tree === tree ? target : undefined;
  });
}
