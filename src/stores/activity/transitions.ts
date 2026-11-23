import type { Commands } from '../../lib/types';
import { withEntry } from '../../lib/record';
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
export interface ActivityState {
  scopes: Record<string, Activity[]>;
}
export interface ProgressUpdate {
  scope: string;
  progress: Progress;
}
export interface ActivityEdit {
  scope: string;
  id: number;
  patch: Partial<Activity>;
}
export interface ActivityStart {
  scope: string;
  activity: Activity;
}
function withScope(
  state: ActivityState,
  scope: string,
  change: (list: Activity[]) => Activity[],
): ActivityState {
  return {
    scopes: withEntry(state.scopes, scope, change(state.scopes[scope] ?? [])),
  };
}
function isRunningSync(entry: Activity) {
  return entry.command === 'sync' && !entry.done;
}
function isShown(entry: Activity) {
  return !entry.done || (entry.visible && entry.held);
}
export function progressed(
  state: ActivityState,
  update: ProgressUpdate,
): ActivityState {
  return withScope(state, update.scope, (list) =>
    list.map((entry) =>
      isRunningSync(entry) ? { ...entry, ...update.progress } : entry,
    ),
  );
}
export function edited(
  state: ActivityState,
  edit: ActivityEdit,
): ActivityState {
  return withScope(state, edit.scope, (list) =>
    list
      .map((entry) =>
        entry.id === edit.id ? { ...entry, ...edit.patch } : entry,
      )
      .filter(isShown),
  );
}
export function started(
  state: ActivityState,
  start: ActivityStart,
): ActivityState {
  return withScope(state, start.scope, (list) => [...list, start.activity]);
}
