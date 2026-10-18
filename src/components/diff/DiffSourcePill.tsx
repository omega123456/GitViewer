import type { Selection } from '../../lib/types';
export const sourceLabels = {
  staged: 'HEAD → index',
  unstaged: 'index → working tree',
  file: 'Working tree · read only',
  commit: 'parent → commit',
  stash: 'base → stash',
  compare: 'base → compare',
};
export function DiffSourcePill({ selection }: { selection: Selection }) {
  return (
    <span className="mx-1.5 shrink-0 rounded border border-line px-2 py-0.5 font-mono text-badge text-muted dark:border-line-dark dark:text-muted-dark">
      {sourceLabels[selection.source]}
      {selection.revision ? ` · ${selection.revision.slice(0, 7)}` : ''}
    </span>
  );
}
