import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it } from 'vitest';
import { QueryProvider } from '../providers/QueryProvider';
import {
  UpdatesSection,
  updateStatus,
} from '../components/settings/UpdatesSection';
import { UpdateBanner } from '../components/states/UpdateBanner';
import { update, settings } from './fixtures';
import { calls, emit, mockCommand } from './harness';
import type { UpdateSnapshot } from '../lib/types';

const available: UpdateSnapshot = {
  ...update,
  availability: 'enabled',
  phase: 'ready',
  lastChecked: '2026-09-09T00:00:00Z',
  available: {
    version: '0.2.0',
    notes: 'Better updates',
    date: '2026-09-08T00:00:00Z',
  },
};
function show(state: UpdateSnapshot = available) {
  mockCommand('update_get', () => state);
  return render(
    <QueryProvider>
      <UpdatesSection settings={settings} />
      <UpdateBanner />
    </QueryProvider>,
  );
}
it('shows build availability and every operation status honestly', () => {
  expect(updateStatus(update)).toContain('development');
  expect(updateStatus({ ...update, availability: 'unconfigured' })).toBe(
    'Updates not configured',
  );
  expect(updateStatus({ ...available, phase: 'idle', lastChecked: null })).toBe(
    'Not checked yet',
  );
  expect(updateStatus({ ...available, phase: 'idle' })).toBe('Up to date');
  for (const [phase, expected] of [
    ['checking', 'Checking'],
    ['downloading', 'Downloading'],
    ['saving', 'Saving'],
    ['installing', 'Installing'],
    ['available', 'An update'],
  ] as const) {
    expect(updateStatus({ ...available, phase })).toContain(expected);
  }
  expect(updateStatus({ ...available, phase: 'error', error: 'Offline' })).toBe(
    'Offline',
  );
});
it('checks manually and saves both update preferences through IPC', async () => {
  mockCommand('update_check', () => available);
  mockCommand('settings_set', (args) => args);
  show();
  await screen.findByText('Better updates');
  fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
  fireEvent.change(screen.getByLabelText('Check for updates'), {
    target: { value: 'off' },
  });
  fireEvent.click(screen.getByLabelText('Install on quit'));
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'settings_set',
      args: { ...settings, installUpdateOnQuit: false },
    }),
  );
  expect(calls).toContainEqual({
    command: 'settings_set',
    args: { ...settings, updateCheckInterval: 'off' },
  });
  expect(calls).toContainEqual({ command: 'update_check', args: {} });
});
it('dismisses a version only in the banner and shows a newer version via events', async () => {
  show();
  await screen.findByRole('complementary');
  fireEvent.click(screen.getByLabelText('Dismiss update'));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(screen.getByText('GitViewer 0.2.0 is available')).toBeVisible();
  mockCommand('update_get', () => ({
    ...available,
    available: { ...available.available!, version: '0.3.0' },
  }));
  await act(async () => emit('update://changed', null));
  await screen.findByRole('complementary');
  expect(screen.getAllByText('GitViewer 0.3.0 is available')).toHaveLength(2);
});
it('installs from either surface and offers recovery after installation failure', async () => {
  mockCommand('update_install', () => available);
  mockCommand('update_quit', () => available);
  show({
    ...available,
    phase: 'error',
    error: 'Installer failed',
    canQuitWithoutUpdating: true,
  });
  await screen.findByRole('alert');
  for (const button of screen.getAllByRole('button', {
    name: 'Install and restart',
  }))
    fireEvent.click(button);
  for (const button of screen.getAllByRole('button', {
    name: 'Quit without updating',
  }))
    fireEvent.click(button);
  await waitFor(() =>
    expect(
      calls.filter((call) => call.command === 'update_install'),
    ).toHaveLength(2),
  );
  expect(calls.filter((call) => call.command === 'update_quit')).toHaveLength(
    2,
  );
  fireEvent.click(screen.getByLabelText('Dismiss update'));
  expect(screen.getByRole('complementary')).toBeVisible();
});
it('disables conflicting operations while downloading and supports unknown totals', async () => {
  show({ ...available, phase: 'downloading', downloaded: 2, total: 4 });
  const progress = await screen.findByRole('progressbar');
  expect(progress).toHaveAttribute('value', '2');
  expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
  expect(
    screen
      .getAllByRole('button', { name: 'Install and restart' })
      .every((button) => button.hasAttribute('disabled')),
  ).toBe(true);
  mockCommand('update_get', () => ({
    ...available,
    phase: 'downloading',
    total: null,
  }));
  await act(async () => emit('update://changed', null));
  await waitFor(() => expect(progress).not.toHaveAttribute('value'));
});
it('handles loading, missing configuration, and IPC errors', async () => {
  mockCommand('update_get', () => {
    throw new Error('Unavailable');
  });
  const view = render(
    <QueryProvider>
      <UpdatesSection settings={settings} />
    </QueryProvider>,
  );
  expect(screen.getByText('Loading update status…')).toBeVisible();
  await screen.findByText('Couldn’t load update status.');
  mockCommand('update_get', () => ({
    ...update,
    availability: 'unconfigured',
  }));
  await act(async () => emit('update://changed', null));
  await screen.findByText('Updates not configured');
  expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
  view.unmount();
});
