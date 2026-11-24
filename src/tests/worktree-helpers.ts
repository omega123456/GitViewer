import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';
import type { Applied, Status, Worktree } from '../lib/types';
import { useSuccesses } from '../stores/successes';
import { useTabs } from '../stores/tabs';
import {
  HASH_LENGTH,
  branchFixture,
  repository,
  status,
  worktreeFixture,
} from './fixtures';
import { mockCommand } from './harness';
import {
  branches,
  mountApp,
  runAction,
  setup,
  waitForQueriesIdle,
} from './workbench';

export const MAIN = repository.id;
export const SPIKE_OID = '3f9c2a1bb';
export const PRESENT_WORKTREE_COUNT = 5;
export const AHEAD_COMMITS = 2;
export const ORPHAN_COMMITS = 2;
export const APPLIED_FILES = 6;
export const APPLY_BASE = 'b'.repeat(HASH_LENGTH);
export const APPLY_TREE = 'c'.repeat(HASH_LENGTH);
export const APPLIED_SIX: Applied = {
  base: APPLY_BASE,
  tree: APPLY_TREE,
  files: APPLIED_FILES,
  conflicts: 0,
};

export const statuses: Record<string, Status> = {
  [MAIN]: status,
  '/wt/hotfix': {
    ...status,
    branch: 'fix',
    entries: [
      ...status.entries,
      { kind: 'untracked', path: 'more.txt', index: '?', worktree: '?' },
    ],
  },
  '/wt/review': { ...status, branch: 'feature', entries: [] },
  '/wt/spike': {
    ...status,
    branch: '(detached)',
    oid: SPIKE_OID,
    entries: [],
  },
  '/wt/release': { ...status, branch: 'release', entries: [] },
};

export const listed: { worktrees: Worktree[] } = { worktrees: [] };

function projectWorktrees(extra: Worktree[]) {
  return [
    worktreeFixture(MAIN, { main: true, branch: 'main' }),
    worktreeFixture('/wt/hotfix', { branch: 'fix' }),
    worktreeFixture('/wt/review', { branch: 'feature' }),
    worktreeFixture('/wt/spike', { detached: true, oid: SPIKE_OID }),
    worktreeFixture('/wt/release', { branch: 'release', locked: 'on drive' }),
    worktreeFixture('/wt/legacy', {
      branch: 'legacy',
      missing: true,
      prunable: true,
    }),
    ...extra,
  ];
}

function folderName(path: string) {
  return path.split('/').at(-1) ?? path;
}

export function setupProject(extra: Worktree[] = []) {
  setup();
  listed.worktrees = projectWorktrees(extra);
  mockCommand('worktrees', () => listed.worktrees);
  mockCommand('status', ({ repo }) => statuses[repo] ?? status);
  mockCommand('repo_open', ({ path }) => ({
    ...repository,
    id: path,
    name: folderName(path),
    root: path,
    project: MAIN,
    status: statuses[path] ?? status,
  }));
  mockCommand('worktree_prune', () => null);
  mockCommand('branches', () => [
    { ...branches[0], worktree: MAIN },
    { ...branches[1], worktree: '/wt/review' },
    branches[2],
  ]);
}

export function setupProjectWithIdleBranch() {
  setupWorktreeActions();
  mockCommand('branches', () => [
    { ...branches[0], worktree: MAIN },
    { ...branches[1], worktree: '/wt/review' },
    branchFixture('idle'),
    branches[2],
  ]);
}

function targetLabel(mode: string, ref: string) {
  return mode === 'detached' ? '3f9c2a1' : ref;
}

function defaultTargetPath(mode: string, ref: string) {
  if (mode === 'detached') return '/wt/fixture-3f9c2a1';
  const branchSlug = ref.replace(/^origin\//, '').replaceAll('/', '-');
  return `/wt/fixture-${branchSlug}`;
}

function aheadOf(repo: string) {
  return repo === '/wt/review' ? 0 : AHEAD_COMMITS;
}

function orphansOf(repo: string) {
  return repo === '/wt/spike' ? ORPHAN_COMMITS : 0;
}

export function setupWorktreeActions() {
  setupProject();
  mockCommand('worktree_target', ({ mode, ref, path }) => ({
    path: path || defaultTargetPath(mode, ref),
    free: path !== '/wt/taken',
    label: targetLabel(mode, ref),
  }));
  mockCommand('worktree_add', ({ path }) => path);
  mockCommand('worktree_summary', ({ repo }) => ({
    ahead: aheadOf(repo),
    orphans: orphansOf(repo),
    submodules: false,
  }));
  mockCommand('worktree_remove', () => null);
  mockCommand('worktree_unapply', () => null);
  mockCommand('worktree_apply', () => ({ ...APPLIED_SIX }));
}

export function activeTab() {
  return useTabs.getState().tabs[0];
}

export async function openProject() {
  mountApp();
  await waitFor(() =>
    expect(activeTab().members).toHaveLength(PRESENT_WORKTREE_COUNT),
  );
  await waitForQueriesIdle();
}

export function worktreeTrigger() {
  return screen.getByRole('button', {
    name: /^(fixture|hotfix|review|spike)\//,
  });
}

export function sidebarSlider() {
  return screen.getByRole('slider', { name: 'Resize sidebar' });
}

export function branchList() {
  return screen.getByLabelText('Branches');
}

export function branchRow(name: string) {
  return within(branchList()).getByRole('button', {
    name: new RegExp(`^${name}`),
  });
}

export async function menuFor(name: string, view = MAIN) {
  const user = userEvent.setup();
  await runAction('branches', view);
  await user.click(
    within(branchList()).getByRole('button', { name: `Actions for ${name}` }),
  );
  return user;
}

export function uncommittedCount(repo: string) {
  return statuses[repo].entries.length;
}

export function noticeTitles(scope = MAIN) {
  return (useSuccesses.getState().scopes[scope] ?? []).map(
    (notice) => notice.title,
  );
}
