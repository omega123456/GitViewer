import type { Diff } from '../../lib/types';
import { percentOf } from '../../lib/geometry';
import { fileName } from '../../lib/paths';
import { addedInk, removedInk } from '../shared/styles';
export function ImageMeta({ diff }: { diff: Diff }) {
  const before = diff.oldDimensions;
  const after = diff.newDimensions;
  const delta = diff.newSize - diff.oldSize;
  const percent = diff.oldSize ? percentOf(delta, diff.oldSize) : 0;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-2 font-mono text-badge text-muted dark:border-line-dark">
      <span>{fileName(diff.path)}</span>
      <span>
        {before ? `${before.width}×${before.height}` : '—'} →{' '}
        {after ? `${after.width}×${after.height}` : '—'}
      </span>
      <span className={removedInk}>{diff.oldSize.toLocaleString()} B</span>→
      <span className={addedInk}>{diff.newSize.toLocaleString()} B</span>
      {Boolean(diff.oldSize) && (
        <span className="text-modified dark:text-modified-dark">
          {delta > 0 ? '+' : '−'}
          {Math.abs(percent).toFixed(1)}%
        </span>
      )}
    </div>
  );
}
