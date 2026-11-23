import { confirmAction } from './dialog';
import { perform } from './query';
import { listNames, localBranches } from './success';
import { plural } from './text';
import { announcer, useSuccesses } from '../stores/successes';

const key = 'branch_prune';

export async function pruneBranches(repo: string, current: string) {
  const { withdraw } = useSuccesses.getState();
  const say = announcer(repo, key);
  say({
    title: 'Checking remote',
    description: 'Looking for local branches with no remote branch.',
    pending: true,
  });
  const names = await perform('branch_gone', { repo });
  if (!names) return withdraw(repo, key);
  if (!names.length) return;
  const count = plural(names.length, 'branch', 'branches');
  const approved = await confirmAction(
    `Delete ${localBranches(names.length)} with no remote branch?\n\n${listNames(names)}\n\nGit keeps any branch with commits that are not in ${current}.`,
    { title: 'Prune local branches', okLabel: `Delete ${count}` },
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
