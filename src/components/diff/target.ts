import type { Diff, Selection } from '../../lib/types';
export interface DiffTarget {
  repo: string;
  selection: Selection;
  data: Diff | undefined;
}
export interface LoadedDiff extends DiffTarget {
  data: Diff;
}
