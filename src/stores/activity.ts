import { create } from 'zustand';
import type { Commands } from '../lib/types';
import {
  edited,
  progressed,
  started,
  type Activity,
  type ActivityState,
  type Progress,
} from './activity/transitions';
export type { Activity, Progress } from './activity/transitions';
interface ActivityStore extends ActivityState {
  progress: (scope: string, progress: Progress) => void;
}
const revealDelay = 300;
const minimumHold = 400;
let sequence = 0;
export const useActivity = create<ActivityStore>((set) => ({
  scopes: {},
  progress: (scope, progress) =>
    set((state) => progressed(state, { scope: scope, progress: progress })),
}));
function edit(scope: string, id: number, patch: Partial<Activity>) {
  useActivity.setState((state) =>
    edited(state, { scope: scope, id: id, patch: patch }),
  );
}
export function track<K extends keyof Commands>(
  scope: string,
  command: K,
  args: Commands[K]['args'],
) {
  const id = ++sequence;
  const activity: Activity = {
    id: id,
    command: command,
    args: Object.fromEntries(Object.entries(args)),
    visible: false,
    held: false,
    done: false,
  };
  useActivity.setState((state) =>
    started(state, { scope: scope, activity: activity }),
  );
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
