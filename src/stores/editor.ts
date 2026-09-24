import { create } from 'zustand';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { EditorState, Text } from '@codemirror/state';
import { normalizeError } from '../lib/ipc';
import { attempt } from '../lib/query';
import type { Opened } from '../lib/types';
import { useErrors } from './errors';
export interface Buffer {
  path: string;
  state: EditorState;
  saved: Text;
  version: string | null;
  bom: boolean;
  crlf: boolean;
  dirty: boolean;
  saving: boolean;
  conflict?: { current: Opened | null };
}
export const useEditor = create<{
  buffers: Record<string, Buffer | undefined>;
}>(() => ({ buffers: {} }));
function current(repo: string) {
  return useEditor.getState().buffers[repo];
}
function patch(repo: string, change: Partial<Buffer>) {
  useEditor.setState((s) => {
    const buffer = s.buffers[repo];
    return buffer
      ? { buffers: { ...s.buffers, [repo]: { ...buffer, ...change } } }
      : s;
  });
}
export function fileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}
export function useBuffer(repo: string) {
  return useEditor((s) => s.buffers[repo]);
}
export function useDirty(repo: string, path: string) {
  return useEditor(
    (s) => s.buffers[repo]?.path === path && s.buffers[repo].dirty,
  );
}
export function openBuffer(
  repo: string,
  path: string,
  opened: Opened,
  state: EditorState,
) {
  useEditor.setState((s) => ({
    buffers: {
      ...s.buffers,
      [repo]: {
        path,
        state,
        saved: state.doc,
        version: opened.version,
        bom: opened.bom,
        crlf: opened.crlf,
        dirty: false,
        saving: false,
      },
    },
  }));
}
export function track(repo: string, state: EditorState) {
  const buffer = current(repo);
  if (buffer) patch(repo, { state, dirty: !state.doc.eq(buffer.saved) });
}
export function reload(repo: string, opened: Opened) {
  const buffer = current(repo);
  if (!buffer) return;
  const state = buffer.state.update({
    changes: { from: 0, to: buffer.state.doc.length, insert: opened.text },
  }).state;
  patch(repo, {
    state,
    saved: state.doc,
    version: opened.version,
    bom: opened.bom,
    crlf: opened.crlf,
    dirty: false,
    conflict: undefined,
  });
}
export function conflict(repo: string, opened: Opened | null) {
  patch(repo, { conflict: { current: opened } });
}
export function keepEdits(repo: string) {
  const buffer = current(repo);
  if (buffer?.conflict)
    patch(repo, {
      version: buffer.conflict.current?.version ?? null,
      conflict: undefined,
    });
}
export function drop(repo: string) {
  useEditor.setState((s) => ({
    buffers: Object.fromEntries(
      Object.entries(s.buffers).filter(([key]) => key !== repo),
    ),
  }));
}
export async function approveDiscard(repo: string) {
  const buffer = current(repo);
  return (
    !buffer?.dirty ||
    confirm(`Discard unsaved edits to ${fileName(buffer.path)}?`, {
      title: 'Unsaved edits',
    })
  );
}
export function unsavedNames() {
  return Object.values(useEditor.getState().buffers).flatMap((buffer) =>
    buffer?.dirty ? [fileName(buffer.path)] : [],
  );
}
export async function save(repo: string): Promise<void> {
  const buffer = current(repo);
  if (!buffer || buffer.saving) return;
  const doc = buffer.state.doc;
  patch(repo, { saving: true });
  try {
    const result = await attempt('file_write', {
      repo,
      path: buffer.path,
      content: doc.toString(),
      expected: buffer.version,
    });
    useErrors.getState().resolve(repo, 'file_write');
    const latest = current(repo);
    if (!latest) return;
    if ('saved' in result)
      patch(repo, {
        saving: false,
        saved: doc,
        version: result.saved,
        dirty: !latest.state.doc.eq(doc),
      });
    else patch(repo, { saving: false, conflict: { current: result.conflict } });
  } catch (error) {
    patch(repo, { saving: false });
    useErrors.getState().report(repo, normalizeError(error), {
      command: 'file_write',
      title: `Could not save ${fileName(buffer.path)}`,
      retryLabel: 'Retry',
      retry: () => save(repo),
    });
  }
}
