import type { Diff, Source } from '../../lib/types';
const editableSources: ReadonlySet<Source> = new Set([
  'unstaged',
  'staged',
  'file',
]);
export function canEdit(
  source: Source,
  status: string | undefined,
  data: Diff | undefined,
): data is Diff {
  const unsupportedSource = !editableSources.has(source);
  if (unsupportedSource || status === 'D' || data === undefined) return false;
  const uneditable = data.binary || data.image || data.tooLarge;
  return !uneditable;
}
