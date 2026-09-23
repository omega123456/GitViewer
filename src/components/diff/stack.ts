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
    return { repo, source: selection.source, revision: selection.revision };
  if (selection.source === 'compare')
    return {
      repo,
      source: 'compare',
      revision: selection.revision,
      base: selection.base,
    };
  return undefined;
}
export function viewStack(
  repo: string,
  stack: Stack,
  commit?: Selection,
  compared?: Comparison,
): StackArgs | undefined {
  if (stack === 'commit') return commit && selectionStack(repo, commit);
  if (stack === 'compare')
    return (
      compared && {
        repo,
        source: 'compare',
        revision: compared.target,
        base: compared.base,
      }
    );
  return { repo, source: stack };
}
export function cachedEntry(
  repo: string,
  selection: Selection,
): { data: Diff; updatedAt: number } | undefined {
  const args = selectionStack(repo, selection);
  if (!args) return undefined;
  const key = queryKey('diff_stack', args);
  const state = client.getQueryState<DiffStack>(key);
  const data = state && !state.isInvalidated ? state.data : undefined;
  const entry = data?.files[selection.path];
  return entry && { data: entry, updatedAt: state!.dataUpdatedAt };
}
