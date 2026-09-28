import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { client } from '../lib/query';
import {
  mockCommand,
  calls,
  emit,
  lastError,
  pendingActivity,
} from './harness';
import { repository } from './fixtures';
import {
  commit,
  setup,
  mount,
  settled,
  count,
  run,
  repoCalls,
} from './workbench';
describe('focus refresh and hidden tabs', () => {
  it('refreshes only the active tab on focus, untracked, and reports to its scope', async () => {
    setup();
    useTabs.getState().open('/second', 'Second');
    useTabs.getState().activate(repository.id);
    mount();
    await screen.findAllByLabelText('Commit message');
    await settled();
    expect(count('refresh')).toBe(0);
    fireEvent.focus(window);
    expect(pendingActivity()).toEqual([]);
    await waitFor(() => expect(count('refresh')).toBe(1));
    expect(calls.find((call) => call.command === 'refresh')?.args).toEqual({
      repo: repository.id,
    });
    await run(repository.id, 'next-tab');
    expect(useTabs.getState().active).toBe('/second');
    act(() => useTabs.getState().open('/third', 'Third'));
    await settled();
    expect(count('refresh')).toBe(1);
    mockCommand('refresh', () => {
      throw new Error('Status failed');
    });
    fireEvent.focus(window);
    await waitFor(() =>
      expect(lastError('/third')?.message).toBe('Status failed'),
    );
    expect(lastError(repository.id)).toBeUndefined();
    expect(
      calls.filter((call) => call.command === 'refresh').at(-1)?.args,
    ).toEqual({ repo: '/third' });
    mockCommand('refresh', () => null);
    fireEvent.focus(window);
    await waitFor(() => expect(lastError('/third')).toBeUndefined());
    expect(count('refresh')).toBe(3);
    act(() => useTabs.getState().activate(''));
    fireEvent.focus(window);
    await settled();
    expect(count('refresh')).toBe(3);
  });
  it('keeps a hidden tab to its badge status and catches up when shown', async () => {
    setup();
    useTabs.getState().open('/second', 'Second');
    useSelection
      .getState()
      .select('/second', { path: 'src/app.ts', source: 'unstaged' });
    mount();
    await waitFor(() => expect(repoCalls('/second')).toContain('diff'));
    await run('/second', 'previous-tab');
    expect(useTabs.getState().active).toBe(repository.id);
    await settled();
    calls.length = 0;
    act(() => emit('repo://status-changed', { repo: '/second' }));
    await waitFor(() => expect(repoCalls('/second')).toEqual(['status']));
    await settled();
    expect(repoCalls('/second')).toEqual(['status']);
    expect(repoCalls(repository.id)).toEqual([]);
    act(() => useTabs.getState().activate('/second'));
    await waitFor(() => expect(repoCalls('/second')).toContain('diff'));
  });
  it('re-lists the expanded folders of a hidden Files tree when its tab is shown', async () => {
    setup();
    let listed = ['app.ts'];
    mockCommand('tree', ({ path }) =>
      path
        ? listed.map((name) => ({
            path: `src/${name}`,
            name,
            directory: false,
            ignored: false,
            status: '',
          }))
        : [
            {
              path: 'src',
              name: 'src',
              directory: true,
              ignored: false,
              status: '',
            },
          ],
    );
    useTabs.getState().open('/second', 'Second');
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^Files/ }));
    const files = await screen.findByRole('tree', { name: 'All files' });
    await user.click(
      await within(files).findByRole('treeitem', { name: 'src' }),
    );
    await within(files).findByRole('treeitem', { name: 'app.ts' });
    for (const [event, name] of [
      ['repo://files-changed', 'first.ts'],
      ['repo://status-changed', 'second.ts'],
    ] as const) {
      await run('/second', 'previous-tab');
      listed = [...listed, name];
      calls.length = 0;
      act(() => emit(event, { repo: '/second' }));
      await settled();
      expect(repoCalls('/second')).not.toContain('tree');
      act(() => useTabs.getState().activate('/second'));
      expect(
        await within(files).findByRole('treeitem', { name }),
      ).toBeVisible();
      expect(
        calls.filter(
          (call) =>
            call.command === 'tree' &&
            (call.args as { path: string }).path === 'src',
        ),
      ).toHaveLength(1);
    }
  });
  it('returns to a hidden editor with its text, history, scroll and focus', async () => {
    setup();
    mockCommand('file_read', () => ({
      text: 'a\nb\nc\n',
      version: 'v1',
      bom: false,
      crlf: false,
    }));
    mockCommand('file_lines', () => 'a\nb\nc\n');
    mockCommand('unsaved_set', () => null);
    useTabs.getState().open('/second', 'Second');
    useTabs.getState().activate(repository.id);
    useSelection
      .getState()
      .select(repository.id, { path: 'src/app.ts', source: 'unstaged' });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const find = async () => {
      const host = await screen.findByLabelText('Editor');
      await waitFor(() =>
        expect(host.querySelector('.cm-editor')).not.toBeNull(),
      );
      return EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
    };
    const before = await find();
    act(() => before.dispatch({ changes: { from: 0, insert: 'typed ' } }));
    before.scrollDOM.scrollTop = 120;
    act(() => before.focus());
    expect(before.hasFocus).toBe(true);
    await run(repository.id, 'next-tab');
    expect(useTabs.getState().active).toBe('/second');
    await run('/second', 'previous-tab');
    const after = await find();
    expect(after).not.toBe(before);
    expect(after.state.doc.toString()).toBe('typed a\nb\nc\n');
    await waitFor(() => expect(after.scrollDOM.scrollTop).toBe(120));
    expect(after.hasFocus).toBe(true);
    act(() => {
      undo(after);
    });
    expect(after.state.doc.toString()).toBe('a\nb\nc\n');
  });
  it('trims loaded history to its first page on a head change and keeps it on screen', async () => {
    setup();
    const page = (index: number) => ({
      commits: Array.from({ length: 100 }, (_, offset) => ({
        ...commit,
        hash: `${index}-${offset}`.padEnd(40, '0'),
        subject: `commit ${index}-${offset}`,
      })),
      cursor: index < 2 ? `cursor-${index + 1}` : null,
    });
    client.setQueryData([repository.id, 'history', ''], {
      pages: [page(0), page(1), page(2)],
      pageParams: ['', 'cursor-1', 'cursor-2'],
    });
    let release = () => {};
    mockCommand(
      'history',
      () =>
        new Promise((resolve) => {
          release = () => resolve(page(0));
        }),
    );
    useLayout.getState().update(repository.id, { mode: 'history' });
    mount();
    expect(await screen.findByText('300')).toBeVisible();
    expect(await screen.findByText('commit 0-0')).toBeVisible();
    expect(count('history')).toBe(0);
    act(() => emit('repo://head-changed', { repo: repository.id }));
    expect(screen.getByText('commit 0-0')).toBeVisible();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    await waitFor(() => expect(count('history')).toBe(1));
    expect(calls.find((call) => call.command === 'history')?.args).toEqual({
      repo: repository.id,
      path: '',
      cursor: '',
    });
    expect(screen.getByText('100')).toBeVisible();
    expect(screen.getByText('commit 0-0')).toBeVisible();
    await act(async () => release());
    await settled();
    expect(screen.getByText('100')).toBeVisible();
    expect(count('history')).toBe(1);
  });
});
