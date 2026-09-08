import type { Diff } from '../../lib/types';
export function ImageMeta({ diff }: { diff: Diff }) {
  const before = diff.oldDimensions;
  const after = diff.newDimensions;
  const delta = diff.newSize - diff.oldSize;
  const percent = diff.oldSize ? (delta / diff.oldSize) * 100 : 0;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-2 font-mono text-label text-muted dark:border-line-dark">
      <span>{diff.path.split('/').at(-1)}</span>
      <span>
        {before ? `${before.width}×${before.height}` : '—'} →{' '}
        {after ? `${after.width}×${after.height}` : '—'}
      </span>
      <span className="text-deleted dark:text-deleted-dark">
        {diff.oldSize.toLocaleString()} B
      </span>
      →
      <span className="text-added dark:text-added-dark">
        {diff.newSize.toLocaleString()} B
      </span>
      {Boolean(diff.oldSize) && (
        <span className="text-modified dark:text-modified-dark">
          {delta > 0 ? '+' : '−'}
          {Math.abs(percent).toFixed(1)}%
        </span>
      )}
    </div>
  );
}
