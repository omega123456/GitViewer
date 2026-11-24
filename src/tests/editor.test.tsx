import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { expect, it } from 'vitest';
import { useLayout } from '../stores/layout';
import { selectionOf } from '../stores/selection';
import {
  calls,
  callsFor,
  count,
  dialog,
  emit,
  host,
  mockCommand,
} from './harness';
import { repository, settings } from './fixtures';
import { findEditorView, runAction } from './workbench';
import {
  WORKING_TEXT,
  editorBuffer,
  gutterMarks,
  mountEditor,
  openedFile,
  pressWindowKey,
  setupEditor,
  startEditing,
  typeIntoEditor,
} from './editor-helpers';

const MODIFIED_LINE = 2;
const DELETED_LINE = 5;
const ADDED_LINE = 8;
const INSERTED_PREFIX_LENGTH = 2;
const MATCH_START = 4;
const MATCH_END = 7;
const KEY_CODE_H = 72;
const KEY_CODE_Z = 90;
const TWO_CONFIRMATIONS = 2;

it('edits in place, saves with the shortcut, and returns to the diff', async () => {
  setupEditor();
  mountEditor();
  const { view } = await startEditing();
  expect(view.state.doc.toString()).toBe(WORKING_TEXT);
  expect(screen.getByRole('button', { name: 'Diff' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await screen.findByText('TypeScript')).toBeVisible();
  expect(screen.getByText('UTF-8')).toBeVisible();
  expect(screen.getByText('LF')).toBeVisible();
  expect(screen.getByText('Ln 1, Col 1')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(document.querySelector('.cm-changes .bg-modified')).not.toBeNull();
  expect(gutterMarks(view)).toEqual([
    [MODIFIED_LINE, 'modified'],
    [DELETED_LINE, 'deleted'],
    [ADDED_LINE, 'added'],
  ]);
  typeIntoEditor(view, 'x\n');
  expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeVisible();
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'unsaved_set',
      args: { paths: ['app.ts'] },
    }),
  );
  pressWindowKey({ key: 's', metaKey: true });
  await waitFor(() =>
    expect(
      screen.queryByRole('img', { name: 'Unsaved changes' }),
    ).not.toBeInTheDocument(),
  );
  expect(callsFor('file_write')[0]).toEqual({
    repo: repository.id,
    path: 'src/app.ts',
    content: `x\n${WORKING_TEXT}`,
    expected: 'v1',
  });
  expect(editorBuffer()?.disk.version).toBe(
    `saved:${WORKING_TEXT.length + INSERTED_PREFIX_LENGTH}`,
  );
  act(() => {
    fireEvent.keyDown(view.contentDOM, { key: 'Escape' });
  });
  expect(await screen.findByRole('button', { name: 'Edit' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(editorBuffer()).toBeUndefined();
});

it('toggles from the registry, opens find, and follows the theme', async () => {
  setupEditor();
  mountEditor();
  await screen.findByRole('button', { name: 'Edit' });
  const before = count('diff');
  await runAction('edit');
  const view = await findEditorView();
  expect(count('diff')).toBe(before);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Find' }));
  expect(
    await screen.findByRole('textbox', { name: 'Find in file' }),
  ).toHaveFocus();
  mockCommand('settings_get', () => ({ ...settings, theme: 'dark' }));
  await act(async () => emit('settings://changed', null));
  await waitFor(() =>
    expect(view.state.facet(EditorView.darkTheme)).toBe(true),
  );
  fireEvent.contextMenu(view.contentDOM);
  expect(count('edit_menu')).toBeGreaterThan(0);
  await user.click(screen.getByRole('button', { name: 'Blame' }));
  expect(selectionOf(repository.id, 'working')?.editing).toBe(false);
});

it('finds matches in the editor from the keyboard and bar controls', async () => {
  setupEditor(openedFile("say 'a' and 'a'\nend\n", 'v1'));
  mountEditor();
  const { user, view } = await startEditing();
  pressWindowKey({ key: 'f', metaKey: true });
  const find = await screen.findByRole('textbox', { name: 'Find in file' });
  const bar = within(screen.getByRole('search'));
  expect(find).toHaveFocus();
  expect(find).toHaveAttribute('autocorrect', 'off');
  expect(find).toHaveAttribute('spellcheck', 'false');
  expect(bar.queryByRole('textbox', { name: 'Replace with' })).toBeNull();
  await user.type(find, "'a'");
  const selected = () =>
    view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    );
  expect(selected()).toBe("'a'");
  expect(bar.getByRole('status')).toHaveTextContent('1 of 2');
  await user.keyboard('{Enter}');
  expect(bar.getByRole('status')).toHaveTextContent('2 of 2');
  await user.keyboard('{Shift>}{Enter}{/Shift}');
  expect(bar.getByRole('status')).toHaveTextContent('1 of 2');
  pressWindowKey({ key: 'F3' });
  expect(bar.getByRole('status')).toHaveTextContent('2 of 2');
  pressWindowKey({ key: 'F3', shiftKey: true });
  expect(bar.getByRole('status')).toHaveTextContent('1 of 2');
  act(() => view.dispatch({ selection: { anchor: 0 } }));
  expect(bar.getByRole('status')).toHaveTextContent('2 results');
  await user.click(bar.getByRole('button', { name: 'Next match' }));
  expect(bar.getByRole('status')).toHaveTextContent('1 of 2');
  await user.click(bar.getByRole('button', { name: 'Previous match' }));
  expect(bar.getByRole('status')).toHaveTextContent('2 of 2');
  act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
  await user.clear(find);
  expect(bar.getByRole('status')).toBeEmptyDOMElement();
  await user.click(screen.getByRole('button', { name: 'Close find' }));
  expect(screen.queryByRole('search')).toBeNull();
  pressWindowKey({ key: 'f', metaKey: true });
  expect(
    await screen.findByRole('textbox', { name: 'Find in file' }),
  ).toHaveFocus();
  act(() => {
    fireEvent.keyDown(view.contentDOM, { key: 'Escape' });
  });
  expect(screen.queryByRole('search')).toBeNull();
  expect(screen.getByLabelText('Editor')).toBeVisible();
});

it('replaces matches verbatim and restores the previous find and replace values', async () => {
  setupEditor(openedFile("say 'a' and 'a'\nend\n", 'v1'));
  mountEditor();
  const { user, view } = await startEditing();
  pressWindowKey({ key: 'f', metaKey: true });
  const find = await screen.findByRole('textbox', { name: 'Find in file' });
  const bar = within(screen.getByRole('search'));
  await user.type(find, "'a'");
  expect(bar.getByRole('status')).toHaveTextContent('1 of 2');
  act(() =>
    view.dispatch({ selection: { anchor: MATCH_START, head: MATCH_END } }),
  );
  pressWindowKey({ key: 'r', metaKey: true, shiftKey: true });
  const replace = await bar.findByRole('textbox', { name: 'Replace with' });
  expect(replace).toHaveFocus();
  expect(replace).toHaveAttribute('autocorrect', 'off');
  await user.type(replace, '"b"');
  await user.click(bar.getByRole('button', { name: 'Replace' }));
  expect(view.state.doc.toString()).toBe('say "b" and \'a\'\nend\n');
  expect(bar.getByRole('status')).toHaveTextContent('1 of 1');
  await user.click(bar.getByRole('button', { name: 'Replace all' }));
  expect(view.state.doc.toString()).toBe('say "b" and "b"\nend\n');
  expect(bar.getByRole('status')).toHaveTextContent('No results');
  expect(bar.getByRole('button', { name: 'Replace all' })).toBeDisabled();
  fireEvent.keyDown(replace, { key: 'Escape' });
  expect(screen.queryByRole('search')).toBeNull();
  act(() => view.dispatch({ selection: { anchor: 0 } }));
  pressWindowKey({ key: 'r', metaKey: true, shiftKey: true });
  expect(
    await screen.findByRole('textbox', { name: 'Find in file' }),
  ).toHaveValue("'a'");
  expect(screen.getByRole('textbox', { name: 'Replace with' })).toHaveFocus();
  expect(screen.getByRole('textbox', { name: 'Replace with' })).toHaveValue(
    '"b"',
  );
  pressWindowKey({ key: 'f', metaKey: true });
  expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Find in file' })).toHaveFocus();
});

it('opens replace with Ctrl+H from the editor and keeps it for history elsewhere', async () => {
  setupEditor();
  mountEditor();
  const { view } = await startEditing();
  const replaceRow = () =>
    screen.queryByRole('textbox', { name: 'Replace with' });
  act(() => {
    fireEvent.keyDown(view.contentDOM, {
      key: 'h',
      code: 'KeyH',
      keyCode: KEY_CODE_H,
      ctrlKey: true,
    });
  });
  expect(replaceRow()).toBeVisible();
  pressWindowKey({ key: 'f', metaKey: true });
  expect(replaceRow()).toBeNull();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find in file' }), {
    key: 'h',
    ctrlKey: true,
  });
  expect(
    await screen.findByRole('textbox', { name: 'Replace with' }),
  ).toBeVisible();
  act(() => {
    fireEvent.keyDown(view.contentDOM, { key: 'Escape' });
  });
  host.platform = 'windows';
  act(() => {
    fireEvent.keyDown(view.contentDOM, {
      key: 'h',
      code: 'KeyH',
      keyCode: KEY_CODE_H,
      ctrlKey: true,
    });
  });
  expect(replaceRow()).toBeVisible();
  expect(useLayout.getState().tabs[repository.id]?.mode).not.toBe('history');
  pressWindowKey({ key: 'h', ctrlKey: true });
  expect(useLayout.getState().tabs[repository.id]?.mode).toBe('history');
});

it('wraps lines from the button and Alt+Z and shares the setting with the diff', async () => {
  setupEditor();
  mountEditor();
  const { user, view } = await startEditing();
  const button = screen.getByTitle('Word wrap');
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(view.dom.querySelector('.cm-lineWrapping')).toBeNull();
  await user.click(button);
  expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(view.dom.querySelector('.cm-lineWrapping')).not.toBeNull();
  act(() => {
    fireEvent.keyDown(view.contentDOM, {
      key: 'z',
      code: 'KeyZ',
      keyCode: KEY_CODE_Z,
      altKey: true,
    });
  });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(view.dom.querySelector('.cm-lineWrapping')).toBeNull();
  await user.click(button);
  await user.click(screen.getByRole('button', { name: 'Diff' }));
  expect(await screen.findByTitle('Word wrap')).toHaveAttribute(
    'data-state',
    'on',
  );
});

it('reverts unsaved edits in place and lets undo bring them back', async () => {
  setupEditor();
  mountEditor();
  const { user, view } = await startEditing();
  const button = screen.getByRole('button', { name: 'Revert' });
  expect(button).toBeDisabled();
  typeIntoEditor(view, 'x');
  dialog.approved = false;
  await user.click(button);
  expect(dialog.asked).toBe(1);
  expect(view.state.doc.toString()).toBe(`x${WORKING_TEXT}`);
  dialog.approved = true;
  await user.click(button);
  expect(dialog.asked).toBe(TWO_CONFIRMATIONS);
  expect(view.state.doc.toString()).toBe(WORKING_TEXT);
  expect(editorBuffer()?.dirty).toBe(false);
  expect(
    screen.queryByRole('img', { name: 'Unsaved changes' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Diff' })).toBeVisible();
  act(() => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe(`x${WORKING_TEXT}`);
  expect(editorBuffer()?.dirty).toBe(true);
});

it('reloads a clean buffer silently and flags a dirty one', async () => {
  const disk = setupEditor();
  mountEditor();
  const { user, view } = await startEditing();
  disk.change(openedFile('elsewhere', 'v2'));
  await waitFor(() => expect(view.state.doc.toString()).toBe('elsewhere'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  typeIntoEditor(view, 'mine ');
  disk.change(openedFile('again', 'v3'));
  const banner = await screen.findByRole('alert');
  expect(banner).toHaveTextContent('app.ts changed on disk');
  await user.click(
    within(banner).getByRole('button', { name: 'Keep my edits' }),
  );
  expect(editorBuffer()?.disk.version).toBe('v3');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(count('file_write')).toBe(1));
  expect(callsFor('file_write')[0]).toMatchObject({
    content: 'mine elsewhere',
    expected: 'v3',
  });
  typeIntoEditor(view, 'more ');
  disk.change(openedFile('fresh', 'v4'));
  await user.click(
    await screen.findByRole('button', { name: 'Reload from disk' }),
  );
  expect(view.state.doc.toString()).toBe('fresh');
  expect(editorBuffer()?.dirty).toBe(false);
});

it('offers to recreate or discard a file deleted on disk', async () => {
  const disk = setupEditor();
  mountEditor();
  const { user, view } = await startEditing();
  typeIntoEditor(view, 'mine ');
  disk.change(null);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'app.ts was deleted on disk.',
  );
  await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
  expect(editorBuffer()?.disk.version).toBeNull();
  disk.change(openedFile('back', 'v5'));
  await user.click(
    await screen.findByRole('button', { name: 'Keep my edits' }),
  );
  expect(editorBuffer()?.disk.version).toBe('v5');
  disk.change(null);
  await user.click(
    await screen.findByRole('button', { name: 'Discard edits' }),
  );
  await screen.findByRole('button', { name: 'Edit' });
  expect(editorBuffer()).toBeUndefined();
});

it('drops a clean buffer whose file disappears', async () => {
  const disk = setupEditor();
  mountEditor();
  await startEditing();
  disk.change(null);
  expect(
    await screen.findByText("This file can't be edited here"),
  ).toBeVisible();
});

it('turns a save conflict into the banner and a failure into a retryable toast', async () => {
  setupEditor();
  mountEditor();
  const { user, view } = await startEditing();
  typeIntoEditor(view, 'x');
  mockCommand('file_write', () => ({ conflict: openedFile('theirs', 'v9') }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed on disk');
  await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
  mockCommand('file_write', () => {
    throw { category: 'unexpected', message: 'Permission denied' };
  });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Could not save app.ts')).toBeVisible();
  expect(editorBuffer()?.dirty).toBe(true);
  typeIntoEditor(view, 'y');
  mockCommand('file_write', () => ({ saved: 'v10' }));
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(editorBuffer()?.dirty).toBe(false));
  expect(callsFor('file_write').at(-1)).toMatchObject({
    content: `yx${WORKING_TEXT}`,
    expected: 'v9',
  });
});
