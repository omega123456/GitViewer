import { convertFileSrc } from '@tauri-apps/api/core';
import type { Selection } from '../../lib/types';
export function imageUrl(repo: string, selection: Selection, side: string) {
  return `${convertFileSrc('image', 'gitblob')}?${new URLSearchParams({ repo, path: selection.path, source: selection.source, revision: selection.revision ?? '', side })}`;
}
