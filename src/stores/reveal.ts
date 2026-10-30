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
    set((s) => ({ targets: { ...s.targets, [id]: { ...target } } })),
  finish: (id, target) =>
    set((s) =>
      s.targets[id] === target
        ? { targets: { ...s.targets, [id]: undefined } }
        : s,
    ),
}));
export function useRevealTarget(id: string, tree: string) {
  return useReveal((s) => {
    const target = s.targets[id];
    return target?.tree === tree ? target : undefined;
  });
}
