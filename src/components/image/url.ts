import { convertFileSrc } from '@tauri-apps/api/core';
import type { Selection } from '../../lib/types';
export function imageUrl(
  repo: string,
  selection: Selection,
  side: string,
  version = 0,
) {
  return `${convertFileSrc('image', 'gitblob')}?${new URLSearchParams({ repo: repo, path: selection.path, source: selection.source, revision: selection.revision ?? '', base: selection.base ?? '', side: side, version: String(version) })}`;
}
