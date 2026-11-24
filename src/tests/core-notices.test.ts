import { expect, it } from 'vitest';
import { describeSuccess, type Before } from '../lib/success';
import { useSuccesses } from '../stores/successes';
import type { Commands } from '../lib/types';
import { status } from './fixtures';

const FETCH_FOUR = 4;
const PULL_TWO = 2;
const PUSH_THREE = 3;

const sampleStashes = [
  {
    hash: 'h',
    selector: 'stash@{0}',
    message: 'On main: tidy',
    timestamp: 0,
  },
];

function say(
  command: keyof Commands,
  input: {
    args: Record<string, unknown>;
    result?: unknown;
    before?: Before;
  },
) {
  return describeSuccess(command, {
    args: input.args,
    result: input.result ?? null,
    before: input.before ?? { status: status },
  });
}

it('describes sync commands in plain words', () => {
  expect(
    say('sync', { args: { action: 'fetch' }, result: FETCH_FOUR }),
  ).toEqual({
    key: 'sync:fetch',
    title: 'Fetched',
    description: '4 new commits',
  });
  const singleFetch = say('sync', { args: { action: 'fetch' }, result: 1 });
  expect(singleFetch?.description).toBe('1 new commit');
  expect(singleFetch?.info).toBeUndefined();
  expect(say('sync', { args: { action: 'fetch' }, result: 0 })).toMatchObject({
    description: 'Up to date',
    info: true,
  });
  expect(
    say('sync', { args: { action: 'fetch' } })?.description,
  ).toBeUndefined();
  const pullTwo = say('sync', { args: { action: 'pull' }, result: PULL_TWO });
  expect(pullTwo).toMatchObject({
    title: 'Pulled from origin/main',
    description: '2 commits',
  });
  expect(pullTwo?.info).toBeUndefined();
  expect(
    say('sync', { args: { action: 'pull' }, result: 0, before: {} }),
  ).toMatchObject({
    title: 'Pulled from the remote',
    description: 'Already up to date',
    info: true,
  });
  const pushThree = say('sync', {
    args: { action: 'push' },
    result: PUSH_THREE,
  });
  expect(pushThree).toMatchObject({
    title: 'Pushed to origin/main',
    description: '3 commits',
    replaces: 'commit',
  });
  expect(pushThree?.info).toBeUndefined();
  expect(say('sync', { args: { action: 'push' }, result: 0 })).toMatchObject({
    title: 'Nothing to push',
    description: 'origin/main already has every commit',
    info: true,
  });
  expect(say('sync', { args: { action: 'push' } })?.title).toBe(
    'Published main',
  );
  expect(say('sync', { args: { action: 'push' }, before: {} })?.title).toBe(
    'Published branch',
  );
});

it('describes commit and stash commands in plain words', () => {
  expect(
    say('commit', {
      args: { message: 'Fix typo\n\nBody' },
      result: 'a1b2c3d4e5f6',
    }),
  ).toMatchObject({ title: 'Committed', description: 'a1b2c3d Fix typo' });
  expect(say('stash_save', { args: {}, result: 'h' })?.description).toBe(
    '2 files',
  );
  expect(
    say('stash_save', { args: {}, result: 'h', before: {} })?.description,
  ).toBeUndefined();
  expect(
    say('stash_apply', {
      args: { hash: 'h', pop: true },
      before: { stashes: sampleStashes },
    }),
  ).toMatchObject({ title: 'Stash popped', description: 'On main: tidy' });
  expect(
    say('stash_apply', {
      args: { hash: 'x', pop: false },
      before: { stashes: sampleStashes },
    }),
  ).toEqual({ key: 'stash_apply', title: 'Stash applied' });
  expect(
    say('stash_drop', {
      args: { hash: 'h' },
      before: { stashes: sampleStashes },
    }),
  ).toMatchObject({
    title: 'Stash dropped',
    restore: { hash: 'h', message: 'On main: tidy' },
  });
  expect(
    say('stash_drop', { args: { hash: 'x' }, before: {} })?.restore,
  ).toBeUndefined();
  expect(
    say('stash_restore', { args: { hash: 'h', message: 'On main: tidy' } }),
  ).toMatchObject({ title: 'Stash restored', replaces: 'stash_drop' });
});

it('describes branch commands in plain words', () => {
  expect(say('branch_switch', { args: { name: 'dev' } })).toEqual({
    key: 'branch_switch',
    title: 'Switched to dev',
  });
  expect(say('smart_checkout', { args: { name: 'dev' } })?.key).toBe(
    'branch_switch',
  );
  expect(say('branch_create', { args: { name: 'dev' } })?.title).toBe(
    'Created dev',
  );
  expect(say('branch_delete', { args: { name: 'dev' } })?.title).toBe(
    'Deleted dev',
  );
});

it('describes prune commands in plain words', () => {
  expect(say('branch_gone', { args: {}, result: ['old', 'new'] })).toEqual({
    key: 'branch_prune',
    title: 'Found 2 local branches to prune',
    description: 'old, new',
    info: true,
  });
  expect(say('branch_gone', { args: {}, result: [] })).toEqual({
    key: 'branch_prune',
    title: 'No branches to prune',
    description: 'Every local branch still has its remote branch.',
    info: true,
  });
  expect(
    say('branch_prune', { args: {}, result: { deleted: ['a'], kept: [] } }),
  ).toEqual({
    key: 'branch_prune',
    title: 'Pruned 1 local branch',
    description: 'a',
  });
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  expect(
    say('branch_prune', { args: {}, result: { deleted: many, kept: [] } })
      ?.description,
  ).toBe('a, b, c, d, e and 2 more');
  expect(
    say('branch_prune', {
      args: {},
      result: { deleted: many, kept: ['x', 'y'] },
    }),
  ).toEqual({
    key: 'branch_prune',
    title: 'Pruned 7 of 9 local branches',
    description: 'Kept x, y: they have commits that are not in main.',
  });
  expect(
    say('branch_prune', {
      args: {},
      result: { deleted: [], kept: ['x'] },
      before: {},
    }),
  ).toEqual({
    key: 'branch_prune',
    title: 'No branches pruned',
    description: 'Kept x: it has commits that are not in the current branch.',
    info: true,
  });
});

it('describes merge and file commands in plain words', () => {
  expect(
    say('branch_merge', { args: { name: 'dev' }, result: true }),
  ).toMatchObject({ title: 'Merged dev', description: 'into main' });
  expect(
    say('branch_merge', { args: { name: 'dev' }, result: false }),
  ).toBeNull();
  expect(say('merge_abort', { args: {} })?.title).toBe('Merge aborted');
  expect(
    say('files_action', { args: { action: 'discard', paths: ['a', 'b'] } }),
  ).toMatchObject({ title: 'Discarded changes', description: '2 files' });
  expect(
    say('files_action', { args: { action: 'revert', paths: ['a'] } }),
  ).toMatchObject({ title: 'Reverted', description: '1 file' });
  expect(
    say('files_action', { args: { action: 'stage', paths: ['a'] } }),
  ).toBeNull();
  expect(
    say('hunk_action', { args: { action: 'discard', path: 'src/app.ts' } }),
  ).toMatchObject({ description: 'src/app.ts' });
  expect(
    say('hunk_action', { args: { action: 'unstage', path: 'a' } }),
  ).toBeNull();
  expect(say('refresh', { args: {} })).toBeNull();
});

it('keeps one card per command, lets a push replace its commit, and keeps three', () => {
  const { announce, dismiss } = useSuccesses.getState();
  const titles = () =>
    (useSuccesses.getState().scopes.repo ?? []).map((notice) => notice.title);
  announce('repo', { key: 'commit', title: 'Committed' });
  announce('repo', { key: 'sync:fetch', title: 'Fetched' });
  announce('repo', { key: 'sync:fetch', title: 'Fetched again' });
  expect(titles()).toEqual(['Committed', 'Fetched again']);
  announce('repo', { key: 'sync:push', title: 'Pushed', replaces: 'commit' });
  expect(titles()).toEqual(['Fetched again', 'Pushed']);
  announce('repo', { key: 'a', title: 'A' });
  announce('repo', { key: 'b', title: 'B' });
  expect(titles()).toEqual(['Pushed', 'A', 'B']);
  dismiss('repo', useSuccesses.getState().scopes.repo[0].id);
  expect(titles()).toEqual(['A', 'B']);
});

it('evicts cards with an action last, so a new card never pushes out an undo', () => {
  const { announce } = useSuccesses.getState();
  const titles = () =>
    (useSuccesses.getState().scopes.repo ?? []).map((notice) => notice.title);
  const unapply = { target: 't', base: 'b', tree: 'c' };
  announce('repo', {
    key: 'worktree_apply',
    title: 'Applied',
    unapply: unapply,
  });
  announce('repo', { key: 'a', title: 'A' });
  announce('repo', { key: 'b', title: 'B' });
  announce('repo', {
    key: 'worktree_remove',
    title: 'Deleting',
    pending: true,
  });
  expect(titles()).toEqual(['Applied', 'B', 'Deleting']);
  announce('repo', {
    key: 'stash_drop',
    title: 'Dropped',
    restore: { hash: 'h', message: 'm' },
  });
  announce('repo', { key: 'c', title: 'C' });
  expect(titles()).toEqual(['Applied', 'Dropped', 'C']);
  announce('repo', { key: 'd', title: 'D', show: 'main' });
  announce('repo', { key: 'e', title: 'E', show: 'main' });
  expect(titles()).toEqual(['Dropped', 'D', 'E']);
});
