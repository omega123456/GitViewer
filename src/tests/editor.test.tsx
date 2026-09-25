import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { Providers } from '../providers';
import { QueryProvider } from '../providers/QueryProvider';
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { changes } from '../components/editor/setup';
import { registeredActions } from '../lib/actions';
import { closeRepository } from '../lib/repository';
import type { Opened, Selection } from '../lib/types';
import { useEditor } from '../stores/editor';
import { useSelection } from '../stores/selection';
import { useTabs } from '../stores/tabs';
import { useTheme } from '../stores/theme';
import { calls, dialog, emit, mockCommand } from './harness';
import { diff, repository, settings, stack, status } from './fixtures';

const index = 'a\nb\nc\nd\ne\nf\ng\nh\n';
const working = 'a\nB\nc\nd\nf\ng\nh\ni\n';
const selection: Selection = { path: 'src/app.ts', source: 'unstaged' };
function opened(text: string, version: string): Opened {
  return { text, version, bom: false, crlf: false };
}
function setup(file: Opened | null = opened(working, 'v1')) {
  let current = file;
  mockCommand('env', () => ({
    found: true,
    supported: true,
    version: '2.50.1',
  }));
  mockCommand('settings_get', () => settings);
  mockCommand('status', () => status);
  mockCommand('tree', () => []);
  mockCommand('stashes', () => []);
  mockCommand('history', () => ({ commits: [], cursor: null }));
  mockCommand('branches', () => []);
  mockCommand('diff', () => diff);
  mockCommand('diff_stack', () => stack);
  mockCommand('file_lines', () => index);
  mockCommand('file_read', () => current);
  mockCommand('file_write', ({ content }) => {
    current = opened(content, `saved:${content.length}`);
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
function mount(start: Selection = selection) {
  useSelection.getState().select(repository.id, start);
  return render(
    <Providers>
      <App />
    </Providers>,
  );
}
async function editor() {
  const host = await screen.findByLabelText('Editor');
  await waitFor(() => expect(host.querySelector('.cm-editor')).not.toBeNull());
  return EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
}
async function startEditing() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  return { user, view: await editor() };
}
function type(view: EditorView, text: string) {
  act(() => view.dispatch({ changes: { from: 0, insert: text } }));
}
function gutter(view: EditorView) {
  const marks: [number, string][] = [];
  view.state
    .field(changes)
    .markers.between(0, view.state.doc.length, (from, _, marker) => {
      const kind = ['added', 'modified', 'deleted'].find((name) =>
        (marker as unknown as { className: string }).className.includes(name),
      );
      marks.push([view.state.doc.lineAt(from).number, kind ?? '']);
    });
  return marks;
}
function buffer(path = 'src/app.ts') {
  return useEditor.getState().buffers[repository.id]?.[path];
}
function open(path: string, editing?: boolean) {
  return act(async () => {
    useSelection
      .getState()
      .select(repository.id, { path, source: 'unstaged', editing });
  });
}
function openTabs() {
  return useSelection
    .getState()
    .tabs.working[repository.id]?.map((tab) => tab.selection.path);
}
function strip() {
  return screen.getByRole('tablist', { name: 'Open files' });
}
async function editFile(path: string, text: string) {
  await open(path, true);
  await waitFor(() => expect(buffer(path)).toBeDefined());
  type(await editor(), text);
}
const writes = () => calls.filter((call) => call.command === 'file_write');
const key = (init: KeyboardEventInit) =>
  act(() => {
    fireEvent.keyDown(window, init);
  });

describe('working-tree editor', () => {
  it('edits in place, saves with the shortcut, and returns to the diff', async () => {
    setup();
    mount();
    const { view } = await startEditing();
    expect(view.state.doc.toString()).toBe(working);
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
    expect(gutter(view)).toEqual([
      [2, 'modified'],
      [5, 'deleted'],
      [8, 'added'],
    ]);
    type(view, 'x\n');
    expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeVisible();
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'unsaved_set',
        args: { paths: ['app.ts'] },
      }),
    );
    key({ key: 's', metaKey: true });
    await waitFor(() =>
      expect(
        screen.queryByRole('img', { name: 'Unsaved changes' }),
      ).not.toBeInTheDocument(),
    );
    expect(writes()[0].args).toEqual({
      repo: repository.id,
      path: 'src/app.ts',
      content: `x\n${working}`,
      expected: 'v1',
    });
    expect(buffer()?.version).toBe(`saved:${working.length + 2}`);
    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: 'Escape' });
    });
    expect(await screen.findByRole('button', { name: 'Edit' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(buffer()).toBeUndefined();
  });
  it('toggles from the registry, opens find, and follows the theme', async () => {
    setup();
    mount();
    await screen.findByRole('button', { name: 'Edit' });
    await act(async () => {
      await registeredActions(repository.id)
        .find((action) => action.id === 'edit')
        ?.run();
    });
    const view = await editor();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Find' }));
    expect(view.dom.querySelector('.cm-search')).not.toBeNull();
    act(() => useTheme.setState({ preference: 'dark' }));
    expect(view.state.facet(EditorView.darkTheme)).toBe(true);
    fireEvent.contextMenu(view.contentDOM);
    expect(calls.some((call) => call.command === 'edit_menu')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Blame' }));
    expect(useSelection.getState().working[repository.id]?.editing).toBe(false);
  });
  it('reverts unsaved edits in place and lets undo bring them back', async () => {
    setup();
    mount();
    const { user, view } = await startEditing();
    const button = screen.getByRole('button', { name: 'Revert' });
    expect(button).toBeDisabled();
    type(view, 'x');
    dialog.approved = false;
    await user.click(button);
    expect(dialog.asked).toBe(1);
    expect(view.state.doc.toString()).toBe(`x${working}`);
    dialog.approved = true;
    await user.click(button);
    expect(dialog.asked).toBe(2);
    expect(view.state.doc.toString()).toBe(working);
    expect(buffer()?.dirty).toBe(false);
    expect(
      screen.queryByRole('img', { name: 'Unsaved changes' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diff' })).toBeVisible();
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe(`x${working}`);
    expect(buffer()?.dirty).toBe(true);
  });
  it('reloads a clean buffer silently and flags a dirty one', async () => {
    const disk = setup();
    mount();
    const { user, view } = await startEditing();
    disk.change(opened('elsewhere', 'v2'));
    await waitFor(() => expect(view.state.doc.toString()).toBe('elsewhere'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    type(view, 'mine ');
    disk.change(opened('again', 'v3'));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('app.ts changed on disk');
    await user.click(
      within(banner).getByRole('button', { name: 'Keep my edits' }),
    );
    expect(buffer()?.version).toBe('v3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].args).toMatchObject({
      content: 'mine elsewhere',
      expected: 'v3',
    });
    type(view, 'more ');
    disk.change(opened('fresh', 'v4'));
    await user.click(
      await screen.findByRole('button', { name: 'Reload from disk' }),
    );
    expect(view.state.doc.toString()).toBe('fresh');
    expect(buffer()?.dirty).toBe(false);
  });
  it('offers to recreate or discard a file deleted on disk', async () => {
    const disk = setup();
    mount();
    const { user, view } = await startEditing();
    type(view, 'mine ');
    disk.change(null);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'app.ts was deleted on disk.',
    );
    await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
    expect(buffer()?.version).toBeNull();
    disk.change(opened('back', 'v5'));
    await user.click(
      await screen.findByRole('button', { name: 'Keep my edits' }),
    );
    expect(buffer()?.version).toBe('v5');
    disk.change(null);
    await user.click(
      await screen.findByRole('button', { name: 'Discard edits' }),
    );
    await screen.findByRole('button', { name: 'Edit' });
    expect(buffer()).toBeUndefined();
  });
  it('drops a clean buffer whose file disappears', async () => {
    const disk = setup();
    mount();
    await startEditing();
    disk.change(null);
    expect(
      await screen.findByText("This file can't be edited here"),
    ).toBeVisible();
  });
  it('turns a save conflict into the banner and a failure into a retryable toast', async () => {
    setup();
    mount();
    const { user, view } = await startEditing();
    type(view, 'x');
    mockCommand('file_write', () => ({ conflict: opened('theirs', 'v9') }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'changed on disk',
    );
    await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
    mockCommand('file_write', () => {
      throw { category: 'unexpected', message: 'Permission denied' };
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Could not save app.ts')).toBeVisible();
    expect(buffer()?.dirty).toBe(true);
    type(view, 'y');
    mockCommand('file_write', () => ({ saved: 'v10' }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(buffer()?.dirty).toBe(false));
    expect(writes().at(-1)?.args).toMatchObject({
      content: `yx${working}`,
      expected: 'v9',
    });
  });
  it('keeps unsaved edits across tabs and asks only when leaving edit mode', async () => {
    setup();
    mount();
    const { view } = await startEditing();
    type(view, 'x');
    await act(async () => {
      useSelection
        .getState()
        .select(repository.id, { path: 'new.txt', source: 'file' });
      useSelection.getState().viewAll(repository.id, 'unstaged');
    });
    expect(dialog.asked).toBe(0);
    expect(buffer()?.dirty).toBe(true);
    await act(async () => {
      useSelection.getState().select(repository.id, { ...selection });
    });
    expect(useSelection.getState().working[repository.id]?.editing).toBe(true);
    expect((await editor()).state.doc.toString()).toBe(`x${working}`);
    dialog.approved = false;
    await act(async () => {
      useSelection
        .getState()
        .select(repository.id, { ...selection, editing: false });
    });
    expect(dialog.asked).toBe(1);
    expect(useSelection.getState().working[repository.id]?.editing).toBe(true);
    dialog.approved = true;
    await act(async () => {
      useSelection
        .getState()
        .select(repository.id, { ...selection, editing: false });
    });
    await waitFor(() =>
      expect(useSelection.getState().working[repository.id]?.editing).toBe(
        false,
      ),
    );
    expect(buffer()).toBeUndefined();
  });
  it('opens a sidebar click in its own tab without asking', async () => {
    setup();
    mount();
    const { user, view } = await startEditing();
    type(view, 'x');
    await user.click(
      within(screen.getByRole('tree', { name: 'Changes' })).getByRole(
        'treeitem',
        { name: 'new.txt' },
      ),
    );
    expect(dialog.asked).toBe(0);
    const tabs = within(strip()).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['app.ts', 'new.txt']);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(
      within(strip()).getByRole('img', { name: 'Unsaved edits' }),
    ).toBeInTheDocument();
    await user.click(tabs[0]);
    expect((await editor()).state.doc.toString()).toBe(`x${working}`);
  });
  it('closes the oldest tab without unsaved edits past the limit', async () => {
    setup();
    mockCommand('settings_get', () => ({ ...settings, maxFileTabs: 3 }));
    mount();
    const { view } = await startEditing();
    type(view, 'x');
    await open('a.ts');
    await open('b.ts');
    await open('a.ts');
    expect(openTabs()).toEqual(['src/app.ts', 'a.ts', 'b.ts']);
    await open('c.ts');
    expect(openTabs()).toEqual(['src/app.ts', 'a.ts', 'c.ts']);
    await editFile('c.ts', 'y');
    await open('d.ts');
    expect(openTabs()).toEqual(['src/app.ts', 'c.ts', 'd.ts']);
    await editFile('d.ts', 'z');
    await open('e.ts');
    expect(openTabs()).toEqual(['src/app.ts', 'c.ts', 'd.ts', 'e.ts']);
    expect(buffer('a.ts')).toBeUndefined();
    expect(buffer('c.ts')?.dirty).toBe(true);
  });
  it('closes tabs by button, middle click and shortcut, asking only for unsaved edits', async () => {
    setup();
    mount();
    const { user, view } = await startEditing();
    type(view, 'x');
    await open('a.ts');
    await open('b.ts');
    const middle = within(strip()).getByRole('tab', { name: 'a.ts' });
    fireEvent.mouseDown(middle, { button: 1 });
    fireEvent(middle, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    await waitFor(() => expect(openTabs()).toEqual(['src/app.ts', 'b.ts']));
    key({ key: 'w', metaKey: true });
    await waitFor(() => expect(openTabs()).toEqual(['src/app.ts']));
    expect(useSelection.getState().working[repository.id]?.path).toBe(
      'src/app.ts',
    );
    dialog.approved = false;
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    expect(dialog.asked).toBe(1);
    expect(openTabs()).toEqual(['src/app.ts']);
    dialog.approved = true;
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    expect(await screen.findByText('Select a file to review')).toBeVisible();
    expect(
      screen.queryByRole('tablist', { name: 'Open files' }),
    ).not.toBeInTheDocument();
    expect(buffer()).toBeUndefined();
  });
  it('keeps a buffer while another tab still edits the same file', async () => {
    setup();
    mount();
    const { view } = await startEditing();
    type(view, 'x');
    await act(async () => {
      useSelection.getState().select(repository.id, {
        path: 'src/app.ts',
        source: 'staged',
        editing: true,
      });
    });
    expect(
      within(strip())
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['app.tsunstaged', 'app.tsstaged']);
    await act(() =>
      useSelection
        .getState()
        .closeTab(repository.id, 'working', 'staged:::src/app.ts'),
    );
    expect(dialog.asked).toBe(0);
    expect(buffer()?.dirty).toBe(true);
  });
  it('cycles and moves between tabs from the keyboard', async () => {
    setup();
    mount();
    await screen.findByRole('button', { name: 'Edit' });
    await open('a.ts');
    await open('b.ts');
    const active = () => useSelection.getState().working[repository.id]?.path;
    key({ key: 'Tab', ctrlKey: true });
    expect(active()).toBe('src/app.ts');
    key({ key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(active()).toBe('b.ts');
    const tab = within(strip()).getByRole('tab', { name: 'b.ts' });
    fireEvent.keyDown(tab, { key: 'ArrowLeft' });
    expect(active()).toBe('a.ts');
    await waitFor(() =>
      expect(within(strip()).getByRole('tab', { name: 'a.ts' })).toHaveFocus(),
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
    setup();
    useSelection.getState().select(repository.id, {
      path: 'src/app.ts',
      source: 'commit',
      revision: 'abc',
    });
    await act(() =>
      useSelection
        .getState()
        .closeTab(repository.id, 'working', 'commit:abc::src/app.ts'),
    );
    expect(useSelection.getState().working[repository.id]).toEqual({
      path: '',
      source: 'commit',
      revision: 'abc',
      base: undefined,
    });
    expect(useSelection.getState().all[repository.id]).toBe('commit');
  });
  it('confirms closing a tab and quitting with unsaved edits', async () => {
    setup();
    mount();
    const { view } = await startEditing();
    type(view, 'x');
    await editFile('a.ts', 'y');
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'unsaved_set',
        args: { paths: ['app.ts', 'a.ts'] },
      }),
    );
    dialog.approved = false;
    await act(() => closeRepository(useTabs.getState().tabs[0]));
    expect(calls.some((call) => call.command === 'repo_close')).toBe(false);
    await act(async () =>
      emit('session://unsaved-edits', { paths: ['app.ts'] }),
    );
    expect(calls.some((call) => call.command === 'quit')).toBe(false);
    dialog.approved = true;
    await act(async () =>
      emit('session://unsaved-edits', { paths: ['app.ts'] }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.command === 'quit')).toBe(true),
    );
  });
  it('hides Edit for read-only sources and explains files it cannot open', async () => {
    setup(null);
    mount({ path: 'src/app.ts', source: 'commit', revision: 'abc' });
    await screen.findByRole('button', { name: 'Blame' });
    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
    await act(async () => {
      useSelection.getState().select(repository.id, selection);
    });
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Edit' }));
    expect(
      await screen.findByText("This file can't be edited here"),
    ).toBeVisible();
  });
  it('moves stage all to its own shortcut', async () => {
    setup();
    mount();
    await screen.findByRole('button', { name: 'Edit' });
    key({ key: 'a', metaKey: true, shiftKey: true });
    await waitFor(() =>
      expect(calls.some((call) => call.command === 'files_action')).toBe(true),
    );
  });
  it('opens a stacked file in edit mode from its header', async () => {
    setup();
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
    expect(useSelection.getState().working[repository.id]).toMatchObject({
      editing: true,
    });
    expect(useSelection.getState().all[repository.id]).toBeUndefined();
  });
});
