import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SessionProvider } from '../providers/SessionProvider';
import { client, queryKey } from '../lib/query';
import { useTabs } from '../stores/tabs';
import { layoutDefaults, tabLayout, useLayout } from '../stores/layout';
import { calls, callsFor, count, lastError, mockCommand } from './harness';
import { repository } from './fixtures';

const SAVED_SIDEBAR_WIDTH = 420;
const INITIAL_RESIZE_WIDTH = 500;
const SETTLED_SIDEBAR_WIDTH = 512;
const TWO_SAVES = 2;
const FOUR_SAVED_TABS = 4;

function mountSession() {
  return render(
    <SessionProvider>
      <div>Ready</div>
    </SessionProvider>,
  );
}

it('restores repositories, drafts and the active tab, then saves changes in order', async () => {
  mockCommand('session_get', () => ({
    tabs: [
      {
        path: '/a',
        message: 'draft',
        layout: { ...layoutDefaults, width: SAVED_SIDEBAR_WIDTH },
      },
      { path: '/b', message: '' },
    ],
    active: '/a',
  }));
  mockCommand('repo_open', ({ path }) => ({
    ...repository,
    id: path,
    project: path,
    name: path,
    root: path,
  }));
  mountSession();
  await screen.findByText('Ready');
  expect(
    useTabs.getState().tabs.map(({ id }) => ({
      id: id,
      message: useTabs.getState().messages[id],
    })),
  ).toEqual([
    { id: '/a', message: 'draft' },
    { id: '/b', message: '' },
  ]);
  expect(useTabs.getState().active).toBe('/a');
  expect(tabLayout('/a').width).toBe(SAVED_SIDEBAR_WIDTH);
  expect(tabLayout('/b')).toEqual(layoutDefaults);
  expect(client.getQueryData(queryKey('status', { repo: '/b' }))).toEqual(
    repository.status,
  );
  expect(count('session_set')).toBe(0);
  act(() => {
    useTabs.getState().setMessage('/a', 'updated');
    useTabs.getState().close('/b');
  });
  await waitFor(() => expect(count('session_set')).toBe(TWO_SAVES));
  expect(callsFor('session_set').at(-1)).toEqual({
    tabs: [
      {
        path: '/a',
        message: 'updated',
        layout: { ...layoutDefaults, width: SAVED_SIDEBAR_WIDTH },
        shown: true,
      },
    ],
    active: '/a',
  });
});

it('opens every saved tab at once and applies them in session order', async () => {
  mockCommand('session_get', () => ({
    tabs: [
      { path: '/a', message: 'first' },
      { path: '/b', message: 'second' },
      { path: '/missing', message: '' },
      { path: '/c', message: 'third' },
    ],
    active: '/b',
  }));
  const pending = new Map<string, () => void>();
  mockCommand(
    'repo_open',
    ({ path }) =>
      new Promise((resolve, reject) => {
        pending.set(path, () =>
          path === '/missing'
            ? reject(new Error('Repository unavailable'))
            : resolve({
                ...repository,
                id: path,
                project: path,
                name: path,
                root: path,
              }),
        );
      }),
  );
  mountSession();
  await waitFor(() => expect(pending.size).toBe(FOUR_SAVED_TABS));
  expect(callsFor('repo_open').map((args) => args.path)).toEqual([
    '/a',
    '/b',
    '/missing',
    '/c',
  ]);
  expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  for (const path of ['/c', '/missing', '/b']) {
    await act(async () => pending.get(path)?.());
    expect(useTabs.getState().tabs).toEqual([]);
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  }
  await act(async () => pending.get('/a')?.());
  await screen.findByText('Ready');
  expect(
    useTabs.getState().tabs.map(({ id }) => ({
      id: id,
      message: useTabs.getState().messages[id],
    })),
  ).toEqual([
    { id: '/a', message: 'first' },
    { id: '/b', message: 'second' },
    { id: '/c', message: 'third' },
  ]);
  expect(useTabs.getState().active).toBe('/b');
  expect(lastError('app')?.message).toBe('Repository unavailable');
  expect(count('refresh')).toBe(0);
});

it('saves the sidebar size once a resize settles', async () => {
  mountSession();
  await screen.findByText('Ready');
  act(() => useTabs.getState().open('/a', 'a'));
  await waitFor(() => expect(count('session_set')).toBe(1));
  act(() => {
    useLayout.getState().update('/a', { width: INITIAL_RESIZE_WIDTH });
    useLayout.getState().update('/a', { width: SETTLED_SIDEBAR_WIDTH });
  });
  await waitFor(() =>
    expect(callsFor('session_set').at(-1)).toEqual({
      tabs: [
        {
          path: '/a',
          message: '',
          layout: { ...layoutDefaults, width: SETTLED_SIDEBAR_WIDTH },
          shown: true,
        },
      ],
      active: '/a',
    }),
  );
  expect(count('session_set')).toBe(TWO_SAVES);
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
    return { ...repository, id: path, project: path, root: path };
  });
  mountSession();
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
  mountSession();
  await screen.findByText('Ready');
  expect(lastError('app')?.message).toBe('Load failed');
  act(() => useTabs.getState().open('/a', 'a'));
  await waitFor(() => expect(lastError('app')?.message).toBe('Save failed'));
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
    project: path === '/alias' ? '/canonical' : path,
  }));
  mountSession();
  await screen.findByText('Ready');
  expect(useTabs.getState().active).toBe('/canonical');
});

it('restores worktrees into their project tab, shows the saved one and saves each draft', async () => {
  mockCommand('session_get', () => ({
    tabs: [
      { path: '/main', message: 'main draft' },
      { path: '/wt/fix', message: 'fix draft', shown: true },
      { path: '/other', message: '' },
    ],
    active: '/wt/fix',
  }));
  mockCommand('repo_open', ({ path }) => ({
    ...repository,
    id: path,
    root: path,
    project: path === '/other' ? '/other' : '/main',
  }));
  mountSession();
  await screen.findByText('Ready');
  expect(useTabs.getState().tabs).toEqual([
    {
      id: '/main',
      name: 'main',
      view: '/wt/fix',
      members: ['/main', '/wt/fix'],
    },
    { id: '/other', name: 'other', view: '/other', members: ['/other'] },
  ]);
  expect(useTabs.getState().active).toBe('/main');
  act(() => useTabs.getState().setMessage('/main', 'edited'));
  await waitFor(() =>
    expect(callsFor('session_set').at(-1)).toEqual({
      tabs: [
        {
          path: '/main',
          message: 'edited',
          layout: layoutDefaults,
          shown: false,
        },
        {
          path: '/wt/fix',
          message: 'fix draft',
          layout: layoutDefaults,
          shown: true,
        },
        { path: '/other', message: '', layout: layoutDefaults, shown: true },
      ],
      active: '/wt/fix',
    }),
  );
  expect(calls.length).toBeGreaterThan(0);
});
