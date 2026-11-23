import { perform } from './query';
import type { Entry, Settings } from './types';
import { isStagedEntry } from './working-files';
import { useCommit } from '../stores/commit';
import { useErrors } from '../stores/errors';
import { tabMessage, useTabs, type CommitMode } from '../stores/tabs';
export interface CommitRequest {
  message: string;
  mode: CommitMode;
  stage: string[];
}
type SmartCommit = Settings['smartCommit'];
export interface CommitInputs {
  entries: Entry[];
  hasMessage: boolean;
  smartCommit: SmartCommit;
}
export interface CommitPlan {
  staged: boolean;
  changes: string[];
  committable: boolean;
  smartCommit: SmartCommit;
}
export interface CommitRoute {
  repo: string;
  mode: CommitMode;
  plan: CommitPlan;
}
export function commitPlan(inputs: CommitInputs): CommitPlan {
  const { entries, hasMessage, smartCommit } = inputs;
  const staged = entries.some(isStagedEntry);
  const changes = entries.map((entry) => entry.path);
  const smartCommitAllowed = changes.length > 0 && smartCommit !== 'never';
  const hasWork = staged || smartCommitAllowed;
  const committable = hasMessage && hasWork;
  return {
    staged: staged,
    changes: changes,
    committable: committable,
    smartCommit: smartCommit,
  };
}
async function stageFirst(repo: string, stage: string[]) {
  if (stage.length === 0) return true;
  const staged = await perform('files_action', {
    repo: repo,
    paths: stage,
    action: 'stage',
  });
  return staged !== undefined;
}
async function committed(repo: string, request: CommitRequest) {
  if (!(await stageFirst(repo, request.stage))) return false;
  const result = await perform('commit', {
    repo: repo,
    message: request.message,
  });
  return result !== undefined;
}
async function pushAfterCommit(repo: string) {
  useCommit.getState().enter(repo, 'pushing');
  const pushed = await perform('sync', { repo: repo, action: 'push' });
  if (pushed !== undefined) {
    useTabs.getState().setCommitMode(repo, 'commit');
    return;
  }
  useErrors.getState().relabel(repo, 'sync', {
    title: 'Push failed',
    lead: 'Your commit is saved.',
    retryLabel: 'Push again',
  });
}
export async function runCommit(repo: string, request: CommitRequest) {
  useCommit.getState().begin(repo);
  if (await committed(repo, request)) {
    useTabs.getState().setMessage(repo, '');
    if (request.mode === 'commitPush') await pushAfterCommit(repo);
  }
  useCommit.getState().enter(repo, 'idle');
}
export function routeCommit(route: CommitRoute) {
  const { repo, mode, plan } = route;
  const message = tabMessage(repo);
  if (plan.staged)
    return runCommit(repo, { message: message, mode: mode, stage: [] });
  if (plan.smartCommit === 'always')
    return runCommit(repo, {
      message: message,
      mode: mode,
      stage: plan.changes,
    });
  useCommit.getState().ask(repo, mode);
}
