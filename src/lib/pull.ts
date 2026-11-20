import { normalizeError } from './ipc';
import { mergeBranch } from './merge';
import { attempt, freshStatus } from './query';
import type { GitError } from './types';
import { useErrors } from '../stores/errors';

async function mergeUpstream(repo: string) {
  const { branch, upstream } = await freshStatus(repo);
  if (!upstream) return;
  await mergeBranch(repo, upstream, branch, {
    title: 'Pull',
    lead: `${branch} and ${upstream} have diverged.`,
  });
}

async function recoverFromPull(repo: string, failure: GitError) {
  if (failure.category === 'diverged') {
    await mergeUpstream(repo);
    return;
  }
  useErrors.getState().report(repo, failure, {
    command: 'sync',
    retry: () => pull(repo),
  });
}

export async function pull(repo: string) {
  try {
    await attempt('sync', { repo, action: 'pull' });
    useErrors.getState().resolve(repo, 'sync');
  } catch (error) {
    await recoverFromPull(repo, normalizeError(error));
  }
}
