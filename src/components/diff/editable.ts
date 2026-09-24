import type { Diff, Source } from '../../lib/types';
export function canEdit(
  source: Source,
  status: string | undefined,
  data: Diff | undefined,
): data is Diff {
  return (
    ['unstaged', 'staged', 'file'].includes(source) &&
    status !== 'D' &&
    data !== undefined &&
    !data.binary &&
    !data.image &&
    !data.tooLarge
  );
}
