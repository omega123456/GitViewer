import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionProvider } from '../providers/SessionProvider';
import { useTabs } from '../stores/tabs';
import { layoutDefaults, tabLayout, useLayout } from '../stores/layout';
import { calls, emit, lastError, mockCommand } from './harness';
import { repository } from './fixtures';
import { TextInput } from '../components/shared/TextInput';
import { TextArea } from '../components/shared/TextArea';

describe('session persistence', () => {
  it('restores repositories, drafts and the active tab, then saves changes in order', async () => {
    mockCommand('session_get', () => ({
      tabs: [
        {
          path: '/a',
          message: 'draft',
          layout: { ...layoutDefaults, width: 420 },
        },
        { path: '/b', message: '' },
      ],
      active: '/a',
    }));
    mockCommand('repo_open', ({ path }) => ({
      ...repository,
      id: path,
      name: path,
      root: path,
    }));
    render(
      <SessionProvider>
        <div>Ready</div>
      </SessionProvider>,
    );
    await screen.findByText('Ready');
    expect(
      useTabs.getState().tabs.map(({ id, message }) => ({ id, message })),
    ).toEqual([
      { id: '/a', message: 'draft' },
      { id: '/b', message: '' },
    ]);
    expect(useTabs.getState().active).toBe('/a');
    expect(tabLayout('/a').width).toBe(420);
    expect(tabLayout('/b')).toEqual(layoutDefaults);
    expect(calls.some(({ command }) => command === 'session_set')).toBe(false);
    act(() => {
      useTabs.getState().setMessage('/a', 'updated');
      useTabs.getState().close('/b');
    });
    await waitFor(() =>
      expect(
        calls.filter(({ command }) => command === 'session_set'),
      ).toHaveLength(2),
    );
    expect(
      calls.filter(({ command }) => command === 'session_set').at(-1)?.args,
    ).toEqual({
      tabs: [
        {
          path: '/a',
          message: 'updated',
          layout: { ...layoutDefaults, width: 420 },
        },
      ],
      active: '/a',
    });
  });

  it('saves the sidebar size once a resize settles', async () => {
    render(
      <SessionProvider>
        <div>Ready</div>
      </SessionProvider>,
    );
    await screen.findByText('Ready');
    act(() => useTabs.getState().open('/a', 'a'));
    await waitFor(() =>
      expect(
        calls.filter(({ command }) => command === 'session_set'),
      ).toHaveLength(1),
    );
    act(() => {
      useLayout.getState().update('/a', { width: 500 });
      useLayout.getState().update('/a', { width: 512 });
    });
    await waitFor(() =>
      expect(
        calls.filter(({ command }) => command === 'session_set').at(-1)?.args,
      ).toEqual({
        tabs: [
          {
            path: '/a',
            message: '',
            layout: { ...layoutDefaults, width: 512 },
          },
        ],
        active: '/a',
      }),
    );
    expect(
      calls.filter(({ command }) => command === 'session_set'),
    ).toHaveLength(2);
  });

  it('continues restoring when a repository is unavailable', async () => {
    mockCommand('session_get', () => ({
      tabs: [
        { path: '/missing', message: '' },
        { path: '/ok', message: 'kept' },
      ],
      active: '/missing',
    }));
    mockCommand('repo_open', ({ path }) => {
      if (path === '/missing') throw new Error('Repository unavailable');
      return { ...repository, id: path, root: path };
    });
    render(
      <SessionProvider>
        <div>Ready</div>
      </SessionProvider>,
    );
    await screen.findByText('Ready');
    expect(useTabs.getState().active).toBe('/ok');
    expect(lastError('app')?.message).toContain('Repository unavailable');
  });

  it('shows load and save errors without blocking the application', async () => {
    mockCommand('session_get', () => {
      throw new Error('Load failed');
    });
    mockCommand('session_set', () => {
      throw new Error('Save failed');
    });
    render(
      <SessionProvider>
        <div>Ready</div>
      </SessionProvider>,
    );
    await screen.findByText('Ready');
    expect(lastError('app')?.message).toBe('Load failed');
    act(() => useTabs.getState().open('/a', 'a'));
    await waitFor(() => expect(lastError('app')?.message).toBe('Save failed'));
  });
});

it('disables native completion and correction on text fields', () => {
  render(
    <>
      <TextInput aria-label="Name" />
      <TextArea aria-label="Message" />
    </>,
  );
  for (const field of screen.getAllByRole('textbox')) {
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('autocorrect', 'off');
    expect(field).toHaveAttribute('autocapitalize', 'off');
    expect(field).toHaveAttribute('spellcheck', 'false');
  }
});

it('forwards uncaught frontend errors to native logs', async () => {
  const { useBrowserRestrictions } = await import('../lib/browser');
  function Browser() {
    useBrowserRestrictions();
    return null;
  }
  const { unmount } = render(<Browser />);
  window.dispatchEvent(
    new ErrorEvent('error', { message: 'Unexpected failure' }),
  );
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'frontend_log',
      args: { message: 'Unexpected failure' },
    }),
  );
  unmount();
});

it('replaces the native context menu with the edit menu only on text fields', async () => {
  mockCommand('edit_menu', () => null);
  const { useBrowserRestrictions } = await import('../lib/browser');
  function Browser() {
    useBrowserRestrictions();
    return (
      <>
        <code className="file-content">line</code>
        <input aria-label="Toggle" type="checkbox" />
        <input aria-label="Field" />
        <textarea aria-label="Message" />
      </>
    );
  }
  const { unmount } = render(<Browser />);
  const menus = () =>
    calls.filter(({ command }) => command === 'edit_menu').length;
  for (const target of [
    screen.getByText('line'),
    screen.getByLabelText('Toggle'),
  ])
    expect(fireEvent.contextMenu(target)).toBe(false);
  expect(menus()).toBe(0);
  for (const target of [
    screen.getByLabelText('Field'),
    screen.getByLabelText('Message'),
  ])
    expect(fireEvent.contextMenu(target)).toBe(false);
  expect(menus()).toBe(2);
  unmount();
});

it('flushes the final draft after pending updates before acknowledging close', async () => {
  let finish = () => {};
  mockCommand(
    'session_set',
    () =>
      new Promise<null>((resolve) => {
        finish = () => resolve(null);
      }),
  );
  render(
    <SessionProvider>
      <div>Ready</div>
    </SessionProvider>,
  );
  await screen.findByText('Ready');
  act(() => useTabs.getState().open('/a', 'a'));
  await waitFor(() =>
    expect(calls.some(({ command }) => command === 'session_set')).toBe(true),
  );
  act(() => {
    useTabs.getState().setMessage('/a', 'last keystroke');
    emit('session://save-requested', null);
    emit('session://save-requested', null);
  });
  expect(calls.some(({ command }) => command === 'session_close')).toBe(false);
  await act(async () => finish());
  await act(async () => finish());
  await waitFor(() =>
    expect(calls.filter(({ command }) => command === 'session_close')).toEqual([
      {
        command: 'session_close',
        args: {
          tabs: [
            { path: '/a', message: 'last keystroke', layout: layoutDefaults },
          ],
          active: '/a',
        },
      },
    ]),
  );
});

it('allows editing and another close attempt after a save failure', async () => {
  mockCommand('session_close', () => {
    throw new Error('Disk full');
  });
  const { unmount } = render(
    <SessionProvider>
      <div>Ready</div>
    </SessionProvider>,
  );
  await screen.findByText('Ready');
  act(() => emit('session://save-requested', null));
  await waitFor(() => expect(lastError('app')?.message).toBe('Disk full'));
  act(() => useTabs.getState().open('/a', 'a'));
  await waitFor(() =>
    expect(calls.some(({ command }) => command === 'session_set')).toBe(true),
  );
  mockCommand('session_close', () => null);
  act(() => emit('session://save-requested', null));
  await waitFor(() =>
    expect(
      calls.filter(({ command }) => command === 'session_close'),
    ).toHaveLength(2),
  );
  unmount();
  emit('session://save-requested', null);
  expect(
    calls.filter(({ command }) => command === 'session_close'),
  ).toHaveLength(2);
});

it('restores the active repository using its canonical path', async () => {
  mockCommand('session_get', () => ({
    tabs: [
      { path: '/alias', message: 'draft' },
      { path: '/b', message: '' },
    ],
    active: '/alias',
  }));
  mockCommand('repo_open', ({ path }) => ({
    ...repository,
    id: path === '/alias' ? '/canonical' : path,
  }));
  render(
    <SessionProvider>
      <div>Ready</div>
    </SessionProvider>,
  );
  await screen.findByText('Ready');
  expect(useTabs.getState().active).toBe('/canonical');
});

it('resumes snapshots after native shutdown cancellation', async () => {
  render(
    <SessionProvider>
      <div>Ready</div>
    </SessionProvider>,
  );
  await screen.findByText('Ready');
  act(() => emit('session://save-requested', null));
  await waitFor(() =>
    expect(
      calls.filter(({ command }) => command === 'session_close'),
    ).toHaveLength(1),
  );
  act(() => emit('session://close-cancelled', null));
  act(() => useTabs.getState().open('/after-cancel', 'after-cancel'));
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'session_set',
      args: {
        tabs: [{ path: '/after-cancel', message: '', layout: layoutDefaults }],
        active: '/after-cancel',
      },
    }),
  );
  act(() => emit('session://save-requested', null));
  await waitFor(() =>
    expect(
      calls.filter(({ command }) => command === 'session_close'),
    ).toHaveLength(2),
  );
});
