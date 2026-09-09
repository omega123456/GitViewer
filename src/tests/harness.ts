import { update } from './fixtures';
import { vi } from 'vitest';
import type { Commands, Events } from '../lib/types';
type Handler = (args: never) => unknown;
const handlers = new Map<string, Handler>();
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
export const host = { platform: 'macos' };
export const dialog = { path: null as string | null, approved: true };
export const calls: { command: string; args: unknown }[] = [];
export function mockCommand<K extends keyof Commands>(
  command: K,
  handler: (
    args: Commands[K]['args'],
  ) => Commands[K]['result'] | Promise<Commands[K]['result']>,
) {
  handlers.set(command, handler as Handler);
}
export function resetHarness() {
  handlers.clear();
  mockCommand('update_get', () => ({ ...update }));
  mockCommand('session_get', () => ({ tabs: [], active: '' }));
  mockCommand('session_set', () => null);
  mockCommand('session_close', () => null);
  mockCommand('frontend_log', () => null);
  listeners.clear();
  calls.length = 0;
  host.platform = 'macos';
  dialog.path = null;
  dialog.approved = true;
}
export function emit<K extends keyof Events>(name: K, payload: Events[K]) {
  listeners.get(name)?.forEach((listener) => listener({ payload }));
}
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (name: string, payload: { command: string; args: never }) => {
    if (name !== 'execute') throw new Error(`Unexpected invoke: ${name}`);
    calls.push(payload);
    const handler = handlers.get(payload.command);
    if (!handler) throw new Error(`Unmocked IPC command: ${payload.command}`);
    return handler(payload.args);
  },
  convertFileSrc: (path: string, protocol: string) =>
    `http://${protocol}.localhost/${path}`,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (
    name: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    const group = listeners.get(name) ?? new Set();
    group.add(handler);
    listeners.set(name, group);
    return () => group.delete(handler);
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: async () => dialog.path,
  confirm: async () => dialog.approved,
}));

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => host.platform }));
