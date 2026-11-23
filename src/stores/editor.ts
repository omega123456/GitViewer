import { create } from 'zustand';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { EditorState, Text } from '@codemirror/state';
import { normalizeError } from '../lib/ipc';
import { fileName } from '../lib/paths';
import { attempt } from '../lib/query';
import type { Opened } from '../lib/types';
import { useErrors } from './errors';
import {
  bufferIn,
  diskOf,
  freshBuffer,
  isBufferProtected,
  patched,
  withBuffer,
  withoutBuffer,
  withoutRepo,
  type EditorBuffers,
  type Buffer,
  type FileKey,
  type Reconciliation,
  type ViewMemory,
} from './editor/transitions';
export type {
  Buffer,
  DiskState,
  FileKey,
  ViewMemory,
} from './editor/transitions';
export { reconcile } from './editor/transitions';
export const useEditor = create<EditorBuffers>(() => ({ buffers: {} }));
export function current(key: FileKey) {
  return bufferIn(useEditor.getState(), key);
}
function patch(key: FileKey, change: Partial<Buffer>) {
  useEditor.setState((state) => patched(state, key, change));
}
export function useBuffer(key: FileKey) {
  return useEditor((state) => bufferIn(state, key));
}
export function useDirty(key: FileKey) {
  return useEditor((state) => Boolean(bufferIn(state, key)?.dirty));
}
export function isProtected(key: FileKey) {
  return isBufferProtected(current(key));
}
export function openBuffer(key: FileKey, opened: Opened, state: EditorState) {
  const buffer = freshBuffer(key, opened, state);
  useEditor.setState((store) => withBuffer(store, key, buffer));
}
export function remember(key: FileKey, memory: ViewMemory) {
  patch(key, { memory: memory });
}
export function track(key: FileKey, state: EditorState) {
  const buffer = current(key);
  if (buffer)
    patch(key, { state: state, dirty: !state.doc.eq(buffer.disk.saved) });
}
export function reload(key: FileKey, opened: Opened) {
  const buffer = current(key);
  if (!buffer) return;
  const state = buffer.state.update({
    changes: { from: 0, to: buffer.state.doc.length, insert: opened.text },
  }).state;
  patch(key, {
    state: state,
    disk: diskOf(opened, state.doc),
    dirty: false,
    conflict: undefined,
  });
}
export function conflict(key: FileKey, opened: Opened | null) {
  patch(key, { conflict: { current: opened } });
}
export function keepEdits(key: FileKey) {
  const buffer = current(key);
  if (!buffer?.conflict) return;
  const version = buffer.conflict.current?.version ?? null;
  patch(key, {
    disk: { ...buffer.disk, version: version },
    conflict: undefined,
  });
}
export function drop(key: FileKey) {
  useEditor.setState((state) => withoutBuffer(state, key));
}
export function dropRepo(repo: string) {
  useEditor.setState((state) => withoutRepo(state, repo));
}
export function applyReconciliation(key: FileKey, outcome: Reconciliation) {
  if (outcome.kind === 'conflict') return conflict(key, outcome.current);
  if (outcome.kind === 'reload') return reload(key, outcome.current);
  if (outcome.kind === 'drop') drop(key);
}
export async function approveDiscard(key: FileKey) {
  const buffer = current(key);
  return (
    !buffer?.dirty ||
    confirm(`Discard unsaved edits to ${fileName(buffer.path)}?`, {
      title: 'Unsaved edits',
    })
  );
}
export function unsavedNames(repo?: string) {
  const { buffers } = useEditor.getState();
  return (repo === undefined ? Object.values(buffers) : [buffers[repo]])
    .flatMap((files) => Object.values(files ?? {}))
    .flatMap((buffer) => (buffer.dirty ? [fileName(buffer.path)] : []));
}
function saved(key: FileKey, doc: Text, version: string) {
  const latest = current(key);
  if (!latest) return;
  patch(key, {
    saving: false,
    disk: { ...latest.disk, saved: doc, version: version },
    dirty: !latest.state.doc.eq(doc),
  });
}
function refused(key: FileKey, opened: Opened | null) {
  if (!current(key)) return;
  patch(key, { saving: false, conflict: { current: opened } });
}
export async function save(key: FileKey): Promise<void> {
  const { repo, path } = key;
  const buffer = current(key);
  if (!buffer || buffer.saving) return;
  const doc = buffer.state.doc;
  patch(key, { saving: true });
  try {
    const result = await attempt('file_write', {
      repo: repo,
      path: path,
      content: doc.toString(),
      expected: buffer.disk.version,
    });
    useErrors.getState().resolve(repo, 'file_write');
    if ('saved' in result) return saved(key, doc, result.saved);
    refused(key, result.conflict);
  } catch (error) {
    patch(key, { saving: false });
    useErrors.getState().report(repo, normalizeError(error), {
      command: 'file_write',
      title: `Could not save ${fileName(path)}`,
      retryLabel: 'Retry',
      retry: () => save(key),
    });
  }
}
