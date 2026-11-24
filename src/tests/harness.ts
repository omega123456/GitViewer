import { vi } from 'vitest';
import type { Commands, Events } from '../lib/types';
import { useActivity } from '../stores/activity';
import { useErrors } from '../stores/errors';
import { envMock, generated, update, worktreeFixture } from './fixtures';

type CommandHandlers = {
  [K in keyof Commands]?: (
    args: Commands[K]['args'],
  ) => Commands[K]['result'] | Promise<Commands[K]['result']>;
};
interface DialogState {
  path: string | null;
  approved: boolean;
  asked: number;
  message: string;
  title: string;
}

const handlers: CommandHandlers = {};
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

export const host = { platform: 'macos', version: '15.0.0', title: '' };
export const dialog: DialogState = {
  path: null,
  approved: true,
  asked: 0,
  message: '',
  title: '',
};
export const calls: { command: string; args: unknown }[] = [];

export function mockCommand<K extends keyof Commands>(
  command: K,
  handler: NonNullable<CommandHandlers[K]>,
) {
  handlers[command] = handler;
}

function isCommandCall<K extends keyof Commands>(
  entry: { command: string; args: unknown },
  command: K,
): entry is { command: K; args: Commands[K]['args'] } {
  return entry.command === command;
}

export function callsFor<K extends keyof Commands>(
  command: K,
): Commands[K]['args'][] {
  return calls
    .filter((entry) => isCommandCall(entry, command))
    .map((entry) => entry.args);
}

export function count(command: keyof Commands) {
  return callsFor(command).length;
}

export function clearCalls() {
  calls.length = 0;
}

export function emptyRepoMocks() {
  mockCommand('env', () => envMock);
  mockCommand('tree', () => []);
  mockCommand('stashes', () => []);
  mockCommand('history', () => ({ commits: [], cursor: null }));
  mockCommand('branches', () => []);
}

function clearRecord(record: Record<string, unknown>) {
  for (const key of Object.keys(record)) {
    delete record[key];
  }
}

export function resetHarness() {
  clearRecord(handlers);
  mockCommand('update_get', () => ({ ...update }));
  mockCommand('session_get', () => ({ tabs: [], active: '' }));
  mockCommand('session_set', () => null);
  mockCommand('session_close', () => null);
  mockCommand('frontend_log', () => null);
  mockCommand('clipboard_write', () => null);
  mockCommand('ai_models', () => []);
  mockCommand('ai_key_set', () => null);
  mockCommand('ai_generate', () => ({ ...generated }));
  mockCommand('line_stats', () => ({ staged: {}, unstaged: {} }));
  mockCommand('file_lines', () => null);
  mockCommand('worktrees', ({ repo }) => [
    worktreeFixture(repo, { main: true, branch: 'main' }),
  ]);
  listeners.clear();
  calls.length = 0;
  host.platform = 'macos';
  host.version = '15.0.0';
  host.title = '';
  dialog.path = null;
  dialog.approved = true;
  dialog.asked = 0;
  dialog.message = '';
  dialog.title = '';
}

export function lastError(scope: string) {
  return useErrors.getState().scopes[scope]?.slice(-1)[0]?.error;
}

export function pendingActivity() {
  return Object.values(useActivity.getState().scopes).flat();
}

export function emit<K extends keyof Events>(name: K, payload: Events[K]) {
  listeners.get(name)?.forEach((listener) => listener({ payload: payload }));
}

async function runMockCommand<K extends keyof Commands>(payload: {
  command: K;
  args: Commands[K]['args'];
}) {
  calls.push(payload);
  const handler = handlers[payload.command];
  if (!handler) throw new Error(`Unmocked IPC command: ${payload.command}`);
  return structuredClone(await handler(payload.args));
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async <K extends keyof Commands>(
    name: string,
    payload: { command: K; args: Commands[K]['args'] },
  ) => {
    if (name !== 'execute') throw new Error(`Unexpected invoke: ${name}`);
    return runMockCommand(payload);
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

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => host.platform,
  version: () => host.version,
}));
