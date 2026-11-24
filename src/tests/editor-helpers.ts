import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EditorView } from '@codemirror/view';
import { expect } from 'vitest';
import { changes } from '../components/editor/setup';
import type { Opened, Selection, SettingsResponse } from '../lib/types';
import { client, queryKey } from '../lib/query';
import { useEditor } from '../stores/editor';
import { fileTabsOf, useSelection } from '../stores/selection';
import { useTabs } from '../stores/tabs';
import { DEFAULT_MAX_FILE_TABS } from '../lib/settings';
import { emit, emptyRepoMocks, mockCommand } from './harness';
import { diff, repository, settings, stack, status } from './fixtures';
import { findEditorView, mountApp } from './workbench';

export const INDEX_TEXT = 'a\nb\nc\nd\ne\nf\ng\nh\n';
export const WORKING_TEXT = 'a\nB\nc\nd\nf\ng\nh\ni\n';
export const EDITOR_SELECTION: Selection = {
  path: 'src/app.ts',
  source: 'unstaged',
};

export function openedFile(text: string, version: string): Opened {
  return { text: text, version: version, bom: false, crlf: false };
}

export function setupEditor(
  file: Opened | null = openedFile(WORKING_TEXT, 'v1'),
) {
  let current = file;
  emptyRepoMocks();
  mockCommand('settings_get', () => settings);
  mockCommand('status', () => status);
  mockCommand('diff', () => diff);
  mockCommand('diff_stack', () => stack);
  mockCommand('file_lines', () => INDEX_TEXT);
  mockCommand('file_read', () => current);
  mockCommand('file_write', ({ content }) => {
    current = openedFile(content, `saved:${content.length}`);
    return { saved: current.version };
  });
  mockCommand('files_action', () => null);
  mockCommand('unsaved_set', () => null);
  mockCommand('quit', () => null);
  mockCommand('repo_close', () => null);
  mockCommand('edit_menu', () => null);
  useTabs.getState().open(repository.id, repository.name);
  return {
    change: (next: Opened | null) => {
      current = next;
      act(() => emit('repo://status-changed', { repo: repository.id }));
    },
  };
}

export function mountEditor(start: Selection = EDITOR_SELECTION) {
  useSelection.getState().select(repository.id, start, DEFAULT_MAX_FILE_TABS);
  return mountApp();
}

export async function startEditing() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  return { user: user, view: await findEditorView() };
}

export function typeIntoEditor(view: EditorView, text: string) {
  act(() => view.dispatch({ changes: { from: 0, insert: text } }));
}

function markerClassName(marker: unknown): string {
  if (typeof marker !== 'object' || marker === null || !('className' in marker))
    return '';
  return typeof marker.className === 'string' ? marker.className : '';
}

export function gutterMarks(view: EditorView) {
  const marks: [number, string][] = [];
  view.state
    .field(changes)
    .markers.between(0, view.state.doc.length, (from, _to, marker) => {
      const name = markerClassName(marker);
      const kind = ['added', 'modified', 'deleted'].find((entry) =>
        name.includes(entry),
      );
      marks.push([view.state.doc.lineAt(from).number, kind ?? '']);
    });
  return marks;
}

export function editorBuffer(path = 'src/app.ts') {
  return useEditor.getState().buffers[repository.id]?.[path];
}

function tabLimit() {
  const current = client.getQueryData<SettingsResponse>(
    queryKey('settings_get', {}),
  );
  return current?.maxFileTabs ?? DEFAULT_MAX_FILE_TABS;
}

export function openEditorTab(path: string, editing?: boolean) {
  return act(async () => {
    useSelection
      .getState()
      .select(
        repository.id,
        { path: path, source: 'unstaged', editing: editing },
        tabLimit(),
      );
  });
}

export function openFileTabs() {
  return fileTabsOf(repository.id, 'working')?.map((tab) => tab.selection.path);
}

export function fileTabStrip() {
  return screen.getByRole('tablist', { name: 'Open files' });
}

export async function editTabFile(path: string, text: string) {
  await openEditorTab(path, true);
  await waitFor(() => expect(editorBuffer(path)).toBeDefined());
  typeIntoEditor(await findEditorView(), text);
}

export function pressWindowKey(init: KeyboardEventInit) {
  act(() => {
    fireEvent.keyDown(window, init);
  });
}
