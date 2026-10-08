import { confirm } from '@tauri-apps/plugin-dialog';
import { perform } from './query';
import { listNames, localBranches, type Success } from './success';
import { useSuccesses } from '../stores/successes';

const key = 'branch_prune';

export async function pruneBranches(repo: string, current: string) {
  const { announce, withdraw } = useSuccesses.getState();
  const say = (success: Omit<Success, 'key'>) =>
    announce(repo, { key, info: true, ...success });
  say({
    title: 'Checking remote',
    description: 'Looking for local branches whose remote branch was deleted.',
    pending: true,
  });
  const names = await perform('branch_gone', { repo });
  if (!names) return withdraw(repo, key);
  if (!names.length) return;
  const count = names.length === 1 ? '1 branch' : `${names.length} branches`;
  const approved = await confirm(
    `Delete ${localBranches(names.length)} whose remote branch was deleted?\n\n${listNames(names)}\n\nGit keeps any branch with commits that are not in ${current}.`,
    {
      title: 'Prune local branches',
      kind: 'warning',
      okLabel: `Delete ${count}`,
      cancelLabel: 'Cancel',
    },
  );
  if (!approved)
    return say({
      title: 'Prune cancelled',
      description: `Kept ${localBranches(names.length)}.`,
    });
  say({
    title: `Pruning ${localBranches(names.length)}`,
    description: listNames(names),
    pending: true,
  });
  if (!(await perform('branch_prune', { repo, names }))) withdraw(repo, key);
}
