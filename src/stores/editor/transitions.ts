import type { EditorState, Text } from '@codemirror/state';
import type { Opened } from '../../lib/types';
import { without, withEntry } from '../../lib/record';
export interface FileKey {
  repo: string;
  path: string;
}
export interface DiskState {
  saved: Text;
  version: string | null;
  bom: boolean;
  crlf: boolean;
}
export interface ViewMemory {
  scroll: number;
  focused: boolean;
}
export interface Buffer {
  path: string;
  state: EditorState;
  disk: DiskState;
  dirty: boolean;
  saving: boolean;
  conflict?: { current: Opened | null };
  memory?: ViewMemory;
}
type RepoBuffers = Record<string, Buffer>;
export interface EditorBuffers {
  buffers: Record<string, RepoBuffers | undefined>;
}
export type Reconciliation =
  | { kind: 'unchanged' }
  | { kind: 'conflict'; current: Opened | null }
  | { kind: 'reload'; current: Opened }
  | { kind: 'drop' };
export function diskOf(opened: Opened, saved: Text): DiskState {
  return {
    saved: saved,
    version: opened.version,
    bom: opened.bom,
    crlf: opened.crlf,
  };
}
export function freshBuffer(key: FileKey, opened: Opened, state: EditorState) {
  return {
    path: key.path,
    state: state,
    disk: diskOf(opened, state.doc),
    dirty: false,
    saving: false,
  };
}
export function bufferIn(state: EditorBuffers, key: FileKey) {
  return state.buffers[key.repo]?.[key.path];
}
function repoBuffers(state: EditorBuffers, repo: string): RepoBuffers {
  return state.buffers[repo] ?? {};
}
export function withBuffer(
  state: EditorBuffers,
  key: FileKey,
  buffer: Buffer,
): EditorBuffers {
  const files = withEntry(repoBuffers(state, key.repo), key.path, buffer);
  return { buffers: withEntry(state.buffers, key.repo, files) };
}
export function patched(
  state: EditorBuffers,
  key: FileKey,
  change: Partial<Buffer>,
): EditorBuffers {
  const buffer = bufferIn(state, key);
  if (!buffer) return state;
  return withBuffer(state, key, { ...buffer, ...change });
}
export function withoutBuffer(
  state: EditorBuffers,
  key: FileKey,
): EditorBuffers {
  const files = without(repoBuffers(state, key.repo), key.path);
  return { buffers: withEntry(state.buffers, key.repo, files) };
}
export function withoutRepo(state: EditorBuffers, repo: string): EditorBuffers {
  return { buffers: without(state.buffers, repo) };
}
export function isBufferProtected(buffer: Buffer | undefined) {
  if (!buffer) return false;
  return buffer.dirty || buffer.saving || Boolean(buffer.conflict);
}
export function reconcile(buffer: Buffer, disk: Opened | null): Reconciliation {
  const diskVersion = disk?.version ?? null;
  if (diskVersion === buffer.disk.version) return { kind: 'unchanged' };
  if (buffer.dirty) return { kind: 'conflict', current: disk };
  if (disk) return { kind: 'reload', current: disk };
  return { kind: 'drop' };
}
