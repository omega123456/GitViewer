import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { invoke, normalizeError } from '../lib/ipc';
import {
  client,
  connectEvents,
  perform,
  queryKey,
  useBackend,
  useSeededBackend,
} from '../lib/query';
import { describe as describeFailure, overwrittenPaths } from '../lib/failure';
import { useErrors } from '../stores/errors';
import { answer, ask, useDecision } from '../stores/decision';
import type { Page } from '../lib/types';
import {
  calls,
  clearCalls,
  emit,
  lastError,
  mockCommand,
  pendingActivity,
} from './harness';
import { diff, status } from './fixtures';
import { commit } from './workbench';

const SEEDED_TIMESTAMP = 42;
const THREE_PAGES = 3;

const NEXT_CURSOR: Record<string, string | null> = {
  '': 'one',
  one: 'two',
  two: null,
};

function queryWrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: client }, children);
}

function historyPage(cursor: string): Page {
  return {
    commits: [{ ...commit, hash: `after-${cursor || 'start'}` }],
    cursor: NEXT_CURSOR[cursor] ?? null,
  };
}

it('rejects unmocked commands honestly', async () => {
  await expect(invoke('env', {})).rejects.toMatchObject({
    message: 'Unmocked IPC command: env',
  });
});

it('normalizes all error shapes and performs writes', async () => {
  expect(normalizeError('problem')).toEqual({
    category: 'unexpected',
    message: 'problem',
  });
  expect(normalizeError(new Error('problem')).message).toBe('problem');
  mockCommand('refresh', () => null);
  expect(await perform('refresh', { repo: 'repo' })).toBeNull();
  mockCommand('refresh', () => {
    throw { category: 'refused', message: 'No' };
  });
  expect(await perform('refresh', { repo: 'repo' })).toBeUndefined();
  expect(pendingActivity()).toEqual([]);
  expect(lastError('repo')?.category).toBe('refused');
  expect(lastError('app')).toBeUndefined();
  mockCommand('update_check', () => {
    throw { category: 'network', message: 'Offline' };
  });
  await perform('update_check', {});
  expect(lastError('app')?.category).toBe('network');
  mockCommand('refresh', () => null);
  await useErrors.getState().scopes.repo[0].retry?.();
  expect(useErrors.getState().scopes.repo).toEqual([]);
});

it('keeps the newest three failures per scope and relabels by command', () => {
  const { report, dismiss, resolve, relabel } = useErrors.getState();
  for (const message of ['one', 'two', 'three', 'four'])
    report(
      'repo',
      { category: 'refused', message: message },
      { command: message },
    );
  const messages = () =>
    useErrors.getState().scopes.repo.map((failure) => failure.error.message);
  expect(messages()).toEqual(['two', 'three', 'four']);
  const before = useErrors.getState().scopes;
  resolve('repo', 'absent');
  expect(useErrors.getState().scopes).toBe(before);
  resolve('repo', 'two');
  expect(messages()).toEqual(['three', 'four']);
  relabel('repo', 'four', { title: 'Push failed' });
  expect(
    useErrors.getState().scopes.repo.map((failure) => failure.title),
  ).toEqual([undefined, 'Push failed']);
  dismiss('repo', useErrors.getState().scopes.repo[0].id);
  expect(messages()).toEqual(['four']);
});

it('describes failures with plain headlines and recoveries', () => {
  expect(
    describeFailure({
      category: 'refused',
      message:
        "To origin\n ! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'origin'",
    }),
  ).toMatchObject({ title: 'Push rejected', recovery: 'pull' });
  expect(
    describeFailure({
      category: 'network',
      message: "fatal: unable to access 'x': Could not resolve host",
    }),
  ).toEqual({
    title: 'Could not reach the remote',
    summary: "Unable to access 'x': Could not resolve host",
    recovery: 'retry',
  });
  expect(
    describeFailure({ category: 'authentication', message: 'denied' }),
  ).toMatchObject({ title: 'Sign-in to the remote failed' });
  expect(
    describeFailure({ category: 'unexpected', message: '' }),
  ).toMatchObject({
    title: 'Something went wrong',
    summary: '',
    recovery: null,
  });
  expect(
    overwrittenPaths(
      'error: Your local changes would be overwritten by checkout:\n\tsrc/app.ts\n\tREADME.md\nAborting',
    ),
  ).toEqual(['src/app.ts', 'README.md']);
});

it('replaces an unanswered decision with the newest question', async () => {
  const decision = {
    slot: 'branch',
    title: 'T',
    body: 'B',
    confirm: 'Go',
  } as const;
  const first = ask('repo', decision);
  const second = ask('repo', decision);
  expect(await first).toBe(false);
  answer('repo', true);
  expect(await second).toBe(true);
  answer('repo', true);
  expect(useDecision.getState().pending).toEqual({});
});

it('invalidates only the event repository and preferences', async () => {
  client.setQueryData(['one', 'status'], status);
  client.setQueryData(['two', 'status'], status);
  client.setQueryData(['one', 'history'], { pages: [] });
  client.setQueryData(['app', 'settings_get'], {});
  const stop = await connectEvents();
  emit('repo://status-changed', { repo: 'one' });
  expect(client.getQueryState(['one', 'status'])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['two', 'status'])?.isInvalidated).toBe(false);
  expect(client.getQueryState(['one', 'history'])?.isInvalidated).toBe(false);
  emit('repo://head-changed', { repo: 'one' });
  expect(client.getQueryState(['one', 'history'])?.isInvalidated).toBe(true);
  emit('settings://changed', null);
  expect(client.getQueryState(['app', 'settings_get'])?.isInvalidated).toBe(
    true,
  );
  emit('sync://progress', {
    repo: 'two',
    message: 'fetching',
    done: false,
  });
  expect(client.getQueryState(['two', 'status'])?.isInvalidated).toBe(false);
  emit('repo://closed', { repo: 'one' });
  expect(client.getQueryState(['one', 'status'])).toBeUndefined();
  expect(client.getQueryState(['two', 'status'])).toBeDefined();
  stop();
  expect(queryKey('env', {})).toEqual(['app', 'env', {}]);
});

it('leaves reference-only queries alone on working-tree events', async () => {
  const references = [
    queryKey('stashes', { repo: 'one' }),
    queryKey('branches', { repo: 'one' }),
    queryKey('blame', { repo: 'one', path: 'a' }),
    queryKey('merge_preview', { repo: 'one', name: 'feature' }),
    queryKey('default_branch', { repo: 'one' }),
    queryKey('commit_files', { repo: 'one', revision: 'a' }),
  ];
  for (const key of references) client.setQueryData(key, []);
  client.setQueryData(queryKey('status', { repo: 'one' }), status);
  const stop = await connectEvents();
  emit('repo://status-changed', { repo: 'one' });
  for (const key of references)
    expect(client.getQueryState(key)?.isInvalidated, String(key[1])).toBe(
      false,
    );
  expect(
    client.getQueryState(queryKey('status', { repo: 'one' }))?.isInvalidated,
  ).toBe(true);
  emit('repo://head-changed', { repo: 'one' });
  for (const key of references)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  stop();
});

it('does not refetch mounted reference-only queries on a status change', async () => {
  mockCommand('stashes', () => []);
  mockCommand('branches', () => []);
  mockCommand('blame', () => []);
  mockCommand('merge_preview', () => ({
    outcome: 'upToDate',
    changed: 0,
    conflicts: [],
  }));
  mockCommand('status', () => status);
  const { result } = renderHook(
    () => [
      useBackend('stashes', { repo: 'one' }),
      useBackend('branches', { repo: 'one' }),
      useBackend('blame', { repo: 'one', path: 'a' }),
      useBackend('merge_preview', { repo: 'one', name: 'feature' }),
      useBackend('status', { repo: 'one' }),
    ],
    { wrapper: queryWrapper },
  );
  await waitFor(() =>
    expect(result.current.every((query) => query.isSuccess)).toBe(true),
  );
  const stop = await connectEvents();
  clearCalls();
  act(() => emit('repo://status-changed', { repo: 'one' }));
  await waitFor(() =>
    expect(calls.map(({ command }) => command)).toEqual(['status']),
  );
  stop();
});

it('reloads only the first history page on a head change and keeps the list meanwhile', async () => {
  let release = () => {};
  let hold = false;
  mockCommand('history', ({ cursor }) => {
    const nextPage = historyPage(cursor ?? '');
    if (!hold) return nextPage;
    return new Promise<Page>((resolve) => {
      release = () => resolve(nextPage);
    });
  });
  client.setQueryData(['one', 'history', ''], {
    pages: [historyPage(''), historyPage('one'), historyPage('two')],
    pageParams: ['', 'one', 'two'],
  });
  const { result } = renderHook(
    () =>
      useInfiniteQuery({
        queryKey: ['one', 'history', ''],
        initialPageParam: '',
        queryFn: ({ pageParam }) =>
          invoke('history', { repo: 'one', path: '', cursor: pageParam }),
        getNextPageParam: (last) => last.cursor ?? undefined,
      }),
    { wrapper: queryWrapper },
  );
  expect(result.current.data?.pages).toHaveLength(THREE_PAGES);
  expect(calls).toHaveLength(0);
  const stop = await connectEvents();
  clearCalls();
  hold = true;
  act(() => emit('repo://head-changed', { repo: 'one' }));
  await waitFor(() => expect(result.current.isFetching).toBe(true));
  expect(result.current.data?.pages).toHaveLength(1);
  expect(result.current.data?.pageParams).toEqual(['']);
  expect(result.current.data?.pages[0].commits).toHaveLength(1);
  expect(calls).toEqual([
    { command: 'history', args: { repo: 'one', path: '', cursor: '' } },
  ]);
  await act(async () => release());
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  expect(result.current.data?.pages).toHaveLength(1);
  expect(calls).toHaveLength(1);
  stop();
});

it('refreshes only file listings when ignored files change', async () => {
  const listings = [
    queryKey('files', { repo: 'one', ignored: true }),
    queryKey('tree', { repo: 'one', path: '' }),
  ];
  const others = [
    queryKey('status', { repo: 'one' }),
    queryKey('stashes', { repo: 'one' }),
    queryKey('diff', { repo: 'one', path: 'a', source: 'unstaged' }),
    queryKey('tree', { repo: 'two', path: '' }),
  ];
  for (const key of [...listings, ...others]) client.setQueryData(key, []);
  const stop = await connectEvents();
  emit('repo://files-changed', { repo: 'one' });
  for (const key of listings)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of others)
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  stop();
});

it('keeps commit, stash and compare diffs valid on working-tree events', async () => {
  const sources = ['unstaged', 'staged', 'commit', 'stash', 'compare'] as const;
  const keys = sources.flatMap((source) => [
    {
      source: source,
      key: queryKey('diff', { repo: 'one', path: 'a', source: source }),
    },
    {
      source: source,
      key: queryKey('diff_stack', { repo: 'one', source: source }),
    },
  ]);
  for (const { key } of keys) client.setQueryData(key, diff);
  const stop = await connectEvents();
  emit('repo://status-changed', { repo: 'one' });
  for (const { source, key } of keys)
    expect(client.getQueryState(key)?.isInvalidated, source).toBe(
      source === 'unstaged' || source === 'staged',
    );
  emit('repo://head-changed', { repo: 'one' });
  for (const { key } of keys)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  stop();
});

it('starts a backend read from initial data without fetching', () => {
  const { result } = renderHook(
    () =>
      useSeededBackend(
        'status',
        { repo: 'one' },
        {
          enabled: true,
          initial: { data: status, updatedAt: SEEDED_TIMESTAMP },
        },
      ),
    { wrapper: queryWrapper },
  );
  expect(result.current.data).toBe(status);
  expect(result.current.dataUpdatedAt).toBe(SEEDED_TIMESTAMP);
  expect(calls).toHaveLength(0);
});
