import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it } from 'vitest';
import { SessionProvider } from '../providers/SessionProvider';
import { useTabs } from '../stores/tabs';
import { layoutDefaults } from '../stores/layout';
import { TextInput } from '../components/shared/TextInput';
import { TextArea } from '../components/shared/TextArea';
import {
  calls,
  callsFor,
  count,
  emit,
  lastError,
  mockCommand,
} from './harness';

const TWO_EDIT_MENUS = 2;
const TWO_CLOSES = 2;

function mountSession() {
  return render(
    <SessionProvider>
      <div>Ready</div>
    </SessionProvider>,
  );
}

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
        <code className="select-text">line</code>
        <input aria-label="Toggle" type="checkbox" />
        <input aria-label="Field" />
        <textarea aria-label="Message" />
      </>
    );
  }
  const { unmount } = render(<Browser />);
  for (const target of [
    screen.getByText('line'),
    screen.getByLabelText('Toggle'),
  ])
    expect(fireEvent.contextMenu(target)).toBe(false);
  expect(count('edit_menu')).toBe(0);
  for (const target of [
    screen.getByLabelText('Field'),
    screen.getByLabelText('Message'),
  ])
    expect(fireEvent.contextMenu(target)).toBe(false);
  expect(count('edit_menu')).toBe(TWO_EDIT_MENUS);
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
  mountSession();
  await screen.findByText('Ready');
  act(() => useTabs.getState().open('/a', 'a'));
  await waitFor(() => expect(count('session_set')).toBeGreaterThan(0));
  act(() => {
    useTabs.getState().setMessage('/a', 'last keystroke');
    emit('session://save-requested', null);
    emit('session://save-requested', null);
  });
  expect(count('session_close')).toBe(0);
  await act(async () => finish());
  await act(async () => finish());
  await waitFor(() =>
    expect(callsFor('session_close')).toEqual([
      {
        tabs: [
          {
            path: '/a',
            message: 'last keystroke',
            layout: layoutDefaults,
            shown: true,
          },
        ],
        active: '/a',
      },
    ]),
  );
});

it('allows editing and another close attempt after a save failure', async () => {
  mockCommand('session_close', () => {
    throw new Error('Disk full');
  });
  const { unmount } = mountSession();
  await screen.findByText('Ready');
  act(() => emit('session://save-requested', null));
  await waitFor(() => expect(lastError('app')?.message).toBe('Disk full'));
  act(() => useTabs.getState().open('/a', 'a'));
  await waitFor(() => expect(count('session_set')).toBeGreaterThan(0));
  mockCommand('session_close', () => null);
  act(() => emit('session://save-requested', null));
  await waitFor(() => expect(count('session_close')).toBe(TWO_CLOSES));
  unmount();
  emit('session://save-requested', null);
  expect(count('session_close')).toBe(TWO_CLOSES);
});

it('resumes snapshots after native shutdown cancellation', async () => {
  mountSession();
  await screen.findByText('Ready');
  act(() => emit('session://save-requested', null));
  await waitFor(() => expect(count('session_close')).toBe(1));
  act(() => emit('session://close-cancelled', null));
  act(() => useTabs.getState().open('/after-cancel', 'after-cancel'));
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'session_set',
      args: {
        tabs: [
          {
            path: '/after-cancel',
            message: '',
            layout: layoutDefaults,
            shown: true,
          },
        ],
        active: '/after-cancel',
      },
    }),
  );
  act(() => emit('session://save-requested', null));
  await waitFor(() => expect(count('session_close')).toBe(TWO_CLOSES));
});
