import { create } from 'zustand';
export type DecisionSlot = 'branch' | 'stash';
export interface Decision {
  slot: DecisionSlot;
  title: string;
  body: string;
  paths?: string[];
  note?: string;
  confirm: string;
}
interface Pending extends Decision {
  settle: (approved: boolean) => void;
}
export const useDecision = create<{ pending: Record<string, Pending> }>(() => ({
  pending: {},
}));
export function answer(repo: string, approved: boolean) {
  const current = useDecision.getState().pending[repo];
  if (!current) return;
  useDecision.setState((state) => ({
    pending: Object.fromEntries(
      Object.entries(state.pending).filter(([key]) => key !== repo),
    ),
  }));
  current.settle(approved);
}
export function ask(repo: string, decision: Decision) {
  answer(repo, false);
  return new Promise<boolean>((settle) =>
    useDecision.setState((state) => ({
      pending: { ...state.pending, [repo]: { ...decision, settle } },
    })),
  );
}
