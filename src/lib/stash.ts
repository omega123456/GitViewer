import { confirm } from '@tauri-apps/plugin-dialog';
import { normalizeError } from './ipc';
import { attempt, perform } from './query';
import { ask } from '../stores/decision';
import { useErrors } from '../stores/errors';
const SMART_APPLY_CATEGORY = 'smart_apply';
export interface StashApply {
  repo: string;
  hash: string;
  pop: boolean;
}
interface ApplyWording {
  question: string;
  title: string;
  combine: string;
}
const popWording: ApplyWording = {
  question: 'Apply and remove this stash?',
  title: 'Pop stash',
  combine: 'Pop and combine',
};
const keepWording: ApplyWording = {
  question: 'Apply this stash and keep it on the stack?',
  title: 'Apply stash',
  combine: 'Apply and combine',
};
function wordingOf(pop: boolean) {
  return pop ? popWording : keepWording;
}
function askToCombine(request: StashApply) {
  return ask(request.repo, {
    slot: 'stash',
    title: 'Combine with your changes?',
    body: 'Your working tree has changes. GitViewer can apply the stash on top of them when they touch different files.',
    confirm: wordingOf(request.pop).combine,
  });
}
async function recoverApply(request: StashApply, error: unknown) {
  const failure = normalizeError(error);
  if (failure.category !== SMART_APPLY_CATEGORY)
    return useErrors
      .getState()
      .report(request.repo, failure, { command: 'stash_apply' });
  if (!(await askToCombine(request))) return;
  await perform('stash_apply', {
    repo: request.repo,
    hash: request.hash,
    pop: request.pop,
    smart: true,
  });
}
export async function applyStash(request: StashApply) {
  const { repo, hash, pop } = request;
  const wording = wordingOf(pop);
  if (!(await confirm(wording.question, { title: wording.title }))) return;
  try {
    await attempt('stash_apply', {
      repo: repo,
      hash: hash,
      pop: pop,
      smart: false,
    });
    useErrors.getState().resolve(repo, 'stash_apply');
  } catch (error) {
    await recoverApply(request, error);
  }
}
export async function dropStash(repo: string, hash: string) {
  const approved = await confirm('Permanently drop this stash?', {
    title: 'Drop stash',
    kind: 'warning',
  });
  if (approved) await perform('stash_drop', { repo, hash });
}
