import { client, queryKey } from '../../lib/query';
import type {
  Commands,
  Comparison,
  Diff,
  DiffStack,
  Selection,
} from '../../lib/types';
import type { Stack } from '../../stores/selection';
type StackArgs = Commands['diff_stack']['args'];
export function selectionStack(
  repo: string,
  selection: Selection,
): StackArgs | undefined {
  if (selection.source === 'commit' || selection.source === 'stash')
    return {
      repo: repo,
      source: selection.source,
      revision: selection.revision,
    };
  if (selection.source === 'compare')
    return {
      repo: repo,
      source: 'compare',
      revision: selection.revision,
      base: selection.base,
    };
  return undefined;
}
export interface StackView {
  repo: string;
  stack: Stack;
  commit?: Selection;
  compared?: Comparison;
}
export function viewStack(view: StackView): StackArgs | undefined {
  const { repo, stack, commit, compared } = view;
  if (stack === 'commit') return commit && selectionStack(repo, commit);
  if (stack === 'compare')
    return (
      compared && {
        repo: repo,
        source: 'compare',
        revision: compared.target,
        base: compared.base,
      }
    );
  return { repo: repo, source: stack };
}
export function cachedEntry(
  repo: string,
  selection: Selection,
): { data: Diff; updatedAt: number } | undefined {
  const args = selectionStack(repo, selection);
  if (!args) return undefined;
  const key = queryKey('diff_stack', args);
  const state = client.getQueryState<DiffStack>(key);
  if (!state || state.isInvalidated) return undefined;
  const entry = state.data?.files[selection.path];
  return entry && { data: entry, updatedAt: state.dataUpdatedAt };
}
