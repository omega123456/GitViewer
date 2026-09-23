import { create } from 'zustand';
import type { Commands } from '../lib/types';
export interface Progress {
  phase: string;
  percent?: number;
}
export interface Activity extends Partial<Progress> {
  id: number;
  command: keyof Commands;
  args: Record<string, unknown>;
  visible: boolean;
  held: boolean;
  done: boolean;
}
interface ActivityStore {
  scopes: Record<string, Activity[]>;
  progress: (scope: string, progress: Progress) => void;
}
const revealDelay = 300;
const minimumHold = 400;
let sequence = 0;
export const useActivity = create<ActivityStore>((set) => ({
  scopes: {},
  progress: (scope, progress) =>
    set((state) => ({
      scopes: {
        ...state.scopes,
        [scope]: (state.scopes[scope] ?? []).map((entry) =>
          entry.command === 'sync' && !entry.done
            ? { ...entry, ...progress }
            : entry,
        ),
      },
    })),
}));
function edit(scope: string, id: number, patch: Partial<Activity>) {
  useActivity.setState((state) => ({
    scopes: {
      ...state.scopes,
      [scope]: (state.scopes[scope] ?? [])
        .map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
        .filter((entry) => !entry.done || (entry.visible && entry.held)),
    },
  }));
}
export function track<K extends keyof Commands>(
  scope: string,
  command: K,
  args: Commands[K]['args'],
) {
  const id = ++sequence;
  useActivity.setState((state) => ({
    scopes: {
      ...state.scopes,
      [scope]: [
        ...(state.scopes[scope] ?? []),
        {
          id,
          command,
          args: Object.fromEntries(Object.entries(args)),
          visible: false,
          held: false,
          done: false,
        },
      ],
    },
  }));
  const reveal = setTimeout(() => {
    edit(scope, id, { visible: true, held: true });
    setTimeout(() => edit(scope, id, { held: false }), minimumHold);
  }, revealDelay);
  return () => {
    clearTimeout(reveal);
    edit(scope, id, { done: true });
  };
}
export function runs<K extends keyof Commands>(
  activity: Activity | undefined,
  command: K,
  match: Partial<Commands[K]['args']> = {},
) {
  return (
    activity?.command === command &&
    Object.entries(match).every(([key, value]) => activity.args[key] === value)
  );
}
export function useBusy(scope: string) {
  return useActivity((state) =>
    (state.scopes[scope] ?? []).some((entry) => !entry.done),
  );
}
export function useCurrentActivity(scope: string) {
  return useActivity((state) =>
    (state.scopes[scope] ?? []).filter((entry) => entry.visible).at(-1),
  );
}
