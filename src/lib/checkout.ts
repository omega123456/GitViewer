import { attempt, freshStatus, perform } from './query';
import { cachedSettings } from './settings';
import { pull } from './pull';
import { normalizeError } from './ipc';
import { overwrittenPaths } from './failure';
import type { GitError } from './types';
import { ask } from '../stores/decision';
import { useErrors } from '../stores/errors';

const OVERWRITE_SIGN = 'would be overwritten';

interface CheckoutTarget {
  repo: string;
  name: string;
}
function askToStash(target: CheckoutTarget, paths: string[]) {
  return ask(target.repo, {
    slot: 'branch',
    title: `Switch to ${target.name}?`,
    body: paths.length
      ? 'Your changes to these files would be overwritten:'
      : 'Your local changes would be overwritten.',
    paths: paths,
    note: 'GitViewer stashes them, switches, and restores them. If they conflict, it returns to the original branch.',
    confirm: 'Stash and switch',
  });
}
async function approvesSmartCheckout(
  target: CheckoutTarget,
  failure: GitError,
) {
  if (!failure.message.includes(OVERWRITE_SIGN)) return false;
  return askToStash(target, overwrittenPaths(failure.message));
}
async function recoverCheckout(target: CheckoutTarget, error: unknown) {
  const failure = normalizeError(error);
  const approved = await approvesSmartCheckout(target, failure);
  if (!approved) {
    useErrors
      .getState()
      .report(target.repo, failure, { command: 'branch_switch' });
    return false;
  }
  const switched = await perform('smart_checkout', {
    repo: target.repo,
    name: target.name,
  });
  return switched !== undefined;
}
async function switchBranch(target: CheckoutTarget) {
  try {
    await attempt('branch_switch', { repo: target.repo, name: target.name });
    useErrors.getState().resolve(target.repo, 'branch_switch');
    return true;
  } catch (error) {
    return recoverCheckout(target, error);
  }
}
async function pullOnCheckout(repo: string) {
  if (!cachedSettings()?.pullOnCheckout) return;
  const status = await freshStatus(repo);
  if (status.upstream) await pull(repo);
}
export async function checkout(repo: string, name: string) {
  const switched = await switchBranch({ repo, name });
  if (switched) await pullOnCheckout(repo);
}
