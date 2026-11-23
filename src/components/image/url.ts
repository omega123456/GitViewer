import { convertFileSrc } from '@tauri-apps/api/core';
import type { Selection } from '../../lib/types';
export interface ImageRequest {
  repo: string;
  selection: Selection;
  side: string;
  version?: number;
}
export function imageUrl(request: ImageRequest) {
  const { repo, selection, side, version = 0 } = request;
  return `${convertFileSrc('image', 'gitblob')}?${new URLSearchParams({ repo: repo, path: selection.path, source: selection.source, revision: selection.revision ?? '', base: selection.base ?? '', side: side, version: String(version) })}`;
}
