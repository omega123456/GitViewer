import { generated, update } from './fixtures';
import { vi } from 'vitest';
import type { Commands, Events } from '../lib/types';
import { useActivity } from '../stores/activity';
import { useErrors } from '../stores/errors';
type Handler = (args: never) => unknown;
const handlers = new Map<string, Handler>();
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
export const host = { platform: 'macos', title: '' };
export const dialog = {
  path: null as string | null,
  approved: true,
  asked: 0,
  message: '',
  title: '',
};
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
  mockCommand('ai_models', () => []);
  mockCommand('ai_key_set', () => null);
  mockCommand('ai_generate', () => ({ ...generated }));
  mockCommand('line_stats', () => ({ staged: {}, unstaged: {} }));
  mockCommand('worktrees', ({ repo }) => [
    {
      id: repo,
      name: repo.split('/').at(-1) ?? repo,
      main: true,
      bare: false,
      branch: 'main',
      oid: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      detached: false,
      locked: null,
      prunable: false,
      missing: false,
    },
  ]);
  listeners.clear();
  calls.length = 0;
  host.platform = 'macos';
  dialog.path = null;
  dialog.approved = true;
  dialog.asked = 0;
  dialog.message = '';
  dialog.title = '';
  host.title = '';
}
export function lastError(scope: string) {
  return useErrors.getState().scopes[scope]?.slice(-1)[0]?.error;
}
export function pendingActivity() {
  return Object.values(useActivity.getState().scopes).flat();
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
    return structuredClone(await handler(payload.args));
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
  confirm: async (message: string, options?: { title?: string }) => {
    dialog.asked += 1;
    dialog.message = message;
    dialog.title = options?.title ?? '';
    return dialog.approved;
  },
  message: async () => undefined,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTitle: async (title: string) => {
      host.title = title;
    },
  }),
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => host.platform }));
