import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { QueryProvider } from '../providers/QueryProvider';
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { closeRepository } from '../lib/repository';
import { allChangesOf, selectionOf, useSelection } from '../stores/selection';
import { useTabs } from '../stores/tabs';
import { DEFAULT_MAX_FILE_TABS } from '../lib/settings';
import { calls, count, dialog, emit, mockCommand } from './harness';
import { repository, settings, status } from './fixtures';
import { findEditorView } from './workbench';
import {
  EDITOR_SELECTION,
  WORKING_TEXT,
  editTabFile,
  editorBuffer,
  fileTabStrip,
  mountEditor,
  openEditorTab,
  openFileTabs,
  pressWindowKey,
  setupEditor,
  startEditing,
  typeIntoEditor,
} from './editor-helpers';

const THREE_TAB_LIMIT = 3;

it('keeps unsaved edits across tabs and asks only when leaving edit mode', async () => {
  setupEditor();
  mountEditor();
  const { view } = await startEditing();
  typeIntoEditor(view, 'x');
  await act(async () => {
    useSelection
      .getState()
      .select(
        repository.id,
        { path: 'new.txt', source: 'file' },
        DEFAULT_MAX_FILE_TABS,
      );
    useSelection.getState().viewAll(repository.id, 'unstaged');
  });
  expect(dialog.asked).toBe(0);
  expect(editorBuffer()?.dirty).toBe(true);
  await act(async () => {
    useSelection
      .getState()
      .select(repository.id, { ...EDITOR_SELECTION }, DEFAULT_MAX_FILE_TABS);
  });
  expect(selectionOf(repository.id, 'working')?.editing).toBe(true);
  expect((await findEditorView()).state.doc.toString()).toBe(
    `x${WORKING_TEXT}`,
  );
  dialog.approved = false;
  await act(async () => {
    useSelection
      .getState()
      .select(
        repository.id,
        { ...EDITOR_SELECTION, editing: false },
        DEFAULT_MAX_FILE_TABS,
      );
  });
  expect(dialog.asked).toBe(1);
  expect(selectionOf(repository.id, 'working')?.editing).toBe(true);
  dialog.approved = true;
  await act(async () => {
    useSelection
      .getState()
      .select(
        repository.id,
        { ...EDITOR_SELECTION, editing: false },
        DEFAULT_MAX_FILE_TABS,
      );
  });
  await waitFor(() =>
    expect(selectionOf(repository.id, 'working')?.editing).toBe(false),
  );
  expect(editorBuffer()).toBeUndefined();
});

it('opens a sidebar click in its own tab without asking', async () => {
  setupEditor();
  mountEditor();
  const { user, view } = await startEditing();
  typeIntoEditor(view, 'x');
  await user.click(
    within(screen.getByRole('tree', { name: 'Changes' })).getByRole(
      'treeitem',
      { name: 'new.txt' },
    ),
  );
  expect(dialog.asked).toBe(0);
  const tabs = within(fileTabStrip()).getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual(['app.ts', 'new.txt']);
  expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  expect(tabs[1].parentElement).toHaveClass(
    'before:h-accent',
    'before:bg-accent',
  );
  expect(tabs[0].parentElement).not.toHaveClass('before:bg-accent');
  expect(
    within(fileTabStrip()).getByRole('img', { name: 'Unsaved edits' }),
  ).toBeInTheDocument();
  await user.click(tabs[0]);
  expect((await findEditorView()).state.doc.toString()).toBe(
    `x${WORKING_TEXT}`,
  );
});

it('closes the oldest tab without unsaved edits past the limit', async () => {
  setupEditor();
  mockCommand('settings_get', () => ({
    ...settings,
    maxFileTabs: THREE_TAB_LIMIT,
  }));
  mountEditor();
  const { view } = await startEditing();
  typeIntoEditor(view, 'x');
  await openEditorTab('a.ts');
  await openEditorTab('b.ts');
  await openEditorTab('a.ts');
  expect(openFileTabs()).toEqual(['src/app.ts', 'a.ts', 'b.ts']);
  await openEditorTab('c.ts');
  expect(openFileTabs()).toEqual(['src/app.ts', 'a.ts', 'c.ts']);
  await editTabFile('c.ts', 'y');
  await openEditorTab('d.ts');
  expect(openFileTabs()).toEqual(['src/app.ts', 'c.ts', 'd.ts']);
  await editTabFile('d.ts', 'z');
  await openEditorTab('e.ts');
  expect(openFileTabs()).toEqual(['src/app.ts', 'c.ts', 'd.ts', 'e.ts']);
  expect(editorBuffer('a.ts')).toBeUndefined();
  expect(editorBuffer('c.ts')?.dirty).toBe(true);
});

it('closes tabs by button, middle click and shortcut, asking only for unsaved edits', async () => {
  setupEditor();
  mountEditor();
  const { user, view } = await startEditing();
  typeIntoEditor(view, 'x');
  await openEditorTab('a.ts');
  await openEditorTab('b.ts');
  const middle = within(fileTabStrip()).getByRole('tab', { name: 'a.ts' });
  fireEvent.mouseDown(middle, { button: 1 });
  fireEvent(middle, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
  await waitFor(() => expect(openFileTabs()).toEqual(['src/app.ts', 'b.ts']));
  pressWindowKey({ key: 'w', metaKey: true });
  await waitFor(() => expect(openFileTabs()).toEqual(['src/app.ts']));
  expect(selectionOf(repository.id, 'working')?.path).toBe('src/app.ts');
  dialog.approved = false;
  await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
  expect(dialog.asked).toBe(1);
  expect(openFileTabs()).toEqual(['src/app.ts']);
  dialog.approved = true;
  await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
  expect(await screen.findByText('Select a file to review')).toBeVisible();
  expect(
    screen.queryByRole('tablist', { name: 'Open files' }),
  ).not.toBeInTheDocument();
  expect(editorBuffer()).toBeUndefined();
});

it('keeps a buffer while another tab still edits the same file', async () => {
  setupEditor();
  mountEditor();
  const { view } = await startEditing();
  typeIntoEditor(view, 'x');
  await act(async () => {
    useSelection
      .getState()
      .select(
        repository.id,
        { path: 'src/app.ts', source: 'staged', editing: true },
        DEFAULT_MAX_FILE_TABS,
      );
  });
  expect(
    within(fileTabStrip())
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['app.tsunstaged', 'app.tsstaged']);
  await act(() =>
    useSelection
      .getState()
      .closeTab(repository.id, 'working', 'staged:::src/app.ts'),
  );
  expect(dialog.asked).toBe(0);
  expect(editorBuffer()?.dirty).toBe(true);
});

it('cycles and moves between tabs from the keyboard', async () => {
  setupEditor();
  mountEditor();
  await screen.findByRole('button', { name: 'Edit' });
  await openEditorTab('a.ts');
  await openEditorTab('b.ts');
  const active = () => selectionOf(repository.id, 'working')?.path;
  pressWindowKey({ key: 'Tab', ctrlKey: true });
  expect(active()).toBe('src/app.ts');
  pressWindowKey({ key: 'Tab', ctrlKey: true, shiftKey: true });
  expect(active()).toBe('b.ts');
  const tab = within(fileTabStrip()).getByRole('tab', { name: 'b.ts' });
  fireEvent.keyDown(tab, { key: 'ArrowLeft' });
  expect(active()).toBe('a.ts');
  await waitFor(() =>
    expect(
      within(fileTabStrip()).getByRole('tab', { name: 'a.ts' }),
    ).toHaveFocus(),
  );
  fireEvent.keyDown(tab, { key: 'End' });
  expect(active()).toBe('b.ts');
  fireEvent.keyDown(tab, { key: 'Home' });
  expect(active()).toBe('src/app.ts');
  fireEvent.keyDown(tab, { key: 'ArrowRight' });
  expect(active()).toBe('a.ts');
  fireEvent.keyDown(tab, { key: 'x' });
  expect(active()).toBe('a.ts');
});

it('falls back to the commit overview after closing the last commit tab', async () => {
  setupEditor();
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'src/app.ts', source: 'commit', revision: 'abc' },
      DEFAULT_MAX_FILE_TABS,
    );
  await act(() =>
    useSelection
      .getState()
      .closeTab(repository.id, 'working', 'commit:abc::src/app.ts'),
  );
  expect(selectionOf(repository.id, 'working')).toEqual({
    path: '',
    source: 'commit',
    revision: 'abc',
    base: undefined,
  });
  expect(allChangesOf(repository.id)).toBe('commit');
});

it('confirms closing a tab and quitting with unsaved edits', async () => {
  setupEditor();
  mountEditor();
  const { view } = await startEditing();
  typeIntoEditor(view, 'x');
  await editTabFile('a.ts', 'y');
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'unsaved_set',
      args: { paths: ['app.ts', 'a.ts'] },
    }),
  );
  dialog.approved = false;
  await act(() => closeRepository(useTabs.getState().tabs[0]));
  expect(count('repo_close')).toBe(0);
  await act(async () => emit('session://unsaved-edits', { paths: ['app.ts'] }));
  expect(count('quit')).toBe(0);
  dialog.approved = true;
  await act(async () => emit('session://unsaved-edits', { paths: ['app.ts'] }));
  await waitFor(() => expect(count('quit')).toBe(1));
});

it('hides Edit for read-only sources and explains files it cannot open', async () => {
  setupEditor(null);
  mountEditor({ path: 'src/app.ts', source: 'commit', revision: 'abc' });
  await screen.findByRole('button', { name: 'Blame' });
  expect(
    screen.queryByRole('button', { name: 'Edit' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    useSelection
      .getState()
      .select(repository.id, EDITOR_SELECTION, DEFAULT_MAX_FILE_TABS);
  });
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Edit' }));
  expect(
    await screen.findByText("This file can't be edited here"),
  ).toBeVisible();
});

it('moves stage all to its own shortcut', async () => {
  setupEditor();
  mountEditor();
  await screen.findByRole('button', { name: 'Edit' });
  pressWindowKey({ key: 'a', metaKey: true, shiftKey: true });
  await waitFor(() => expect(count('files_action')).toBeGreaterThan(0));
});

it('opens a stacked file in edit mode from its header', async () => {
  setupEditor();
  render(
    <QueryProvider>
      <AllChangesPane
        repo={repository.id}
        stack="unstaged"
        status={status}
        settings={settings}
        disabled={false}
      />
    </QueryProvider>,
  );
  const user = userEvent.setup();
  const [edit] = await screen.findAllByRole('button', { name: 'Edit' });
  await user.click(edit);
  expect(selectionOf(repository.id, 'working')).toMatchObject({
    editing: true,
  });
  expect(allChangesOf(repository.id)).toBeUndefined();
});
