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
  buffers: Record<string, Record<string, Buffer> | undefined>;
}>(() => ({ buffers: {} }));
function current(repo: string, path: string) {
  return useEditor.getState().buffers[repo]?.[path];
}
function patch(repo: string, path: string, change: Partial<Buffer>) {
  useEditor.setState((s) => {
    const buffer = s.buffers[repo]?.[path];
    return buffer
      ? {
          buffers: {
            ...s.buffers,
            [repo]: { ...s.buffers[repo], [path]: { ...buffer, ...change } },
          },
        }
      : s;
  });
}
export function fileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}
export function useBuffer(repo: string, path: string) {
  return useEditor((s) => s.buffers[repo]?.[path]);
}
export function useDirty(repo: string, path: string) {
  return useEditor((s) => Boolean(s.buffers[repo]?.[path]?.dirty));
}
export function isProtected(repo: string, path: string) {
  const buffer = current(repo, path);
  return Boolean(buffer && (buffer.dirty || buffer.saving || buffer.conflict));
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
        ...s.buffers[repo],
        [path]: {
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
    },
  }));
}
export function track(repo: string, path: string, state: EditorState) {
  const buffer = current(repo, path);
  if (buffer) patch(repo, path, { state, dirty: !state.doc.eq(buffer.saved) });
}
export function reload(repo: string, path: string, opened: Opened) {
  const buffer = current(repo, path);
  if (!buffer) return;
  const state = buffer.state.update({
    changes: { from: 0, to: buffer.state.doc.length, insert: opened.text },
  }).state;
  patch(repo, path, {
    state,
    saved: state.doc,
    version: opened.version,
    bom: opened.bom,
    crlf: opened.crlf,
    dirty: false,
    conflict: undefined,
  });
}
export function conflict(repo: string, path: string, opened: Opened | null) {
  patch(repo, path, { conflict: { current: opened } });
}
export function keepEdits(repo: string, path: string) {
  const buffer = current(repo, path);
  if (buffer?.conflict)
    patch(repo, path, {
      version: buffer.conflict.current?.version ?? null,
      conflict: undefined,
    });
}
export function drop(repo: string, path?: string) {
  useEditor.setState((s) => ({
    buffers:
      path === undefined
        ? without(s.buffers, repo)
        : { ...s.buffers, [repo]: without(s.buffers[repo] ?? {}, path) },
  }));
}
function without<T>(record: Record<string, T>, key: string) {
  return Object.fromEntries(
    Object.entries(record).filter(([entry]) => entry !== key),
  );
}
export async function approveDiscard(repo: string, path: string) {
  const buffer = current(repo, path);
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
export async function save(repo: string, path: string): Promise<void> {
  const buffer = current(repo, path);
  if (!buffer || buffer.saving) return;
  const doc = buffer.state.doc;
  patch(repo, path, { saving: true });
  try {
    const result = await attempt('file_write', {
      repo,
      path,
      content: doc.toString(),
      expected: buffer.version,
    });
    useErrors.getState().resolve(repo, 'file_write');
    const latest = current(repo, path);
    if (!latest) return;
    if ('saved' in result)
      patch(repo, path, {
        saving: false,
        saved: doc,
        version: result.saved,
        dirty: !latest.state.doc.eq(doc),
      });
    else
      patch(repo, path, {
        saving: false,
        conflict: { current: result.conflict },
      });
  } catch (error) {
    patch(repo, path, { saving: false });
    useErrors.getState().report(repo, normalizeError(error), {
      command: 'file_write',
      title: `Could not save ${fileName(path)}`,
      retryLabel: 'Retry',
      retry: () => save(repo, path),
    });
  }
}
