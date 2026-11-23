import type { Selection } from '../../lib/types';
export type ViewMode = 'rendered' | 'blame' | 'editing';
const plainView: Record<ViewMode, boolean> = {
  rendered: false,
  blame: false,
  editing: false,
};
export function withViewMode(
  selection: Selection,
  mode: ViewMode,
  enabled: boolean,
): Selection {
  return { ...selection, ...plainView, [mode]: enabled };
}
