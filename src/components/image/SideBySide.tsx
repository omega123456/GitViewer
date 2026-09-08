import type { ReactNode } from 'react';
import type { Diff } from '../../lib/types';
export function SideBySide({
  diff,
  image,
}: {
  diff: Diff;
  image: (side: 'old' | 'new') => ReactNode;
}) {
  return (
    <div className="grid max-h-full w-full grid-cols-2 items-end gap-4">
      <Pane caption="HEAD" size={diff.oldSize}>
        {image('old')}
      </Pane>
      <Pane caption="Working tree" size={diff.newSize}>
        {image('new')}
      </Pane>
    </div>
  );
}
function Pane({
  caption,
  size,
  children,
}: {
  caption: string;
  size: number;
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col">
      <div className="flex min-h-0 items-center justify-center">{children}</div>
      <figcaption className="mt-1.5 flex justify-between text-label text-muted">
        <span>{caption}</span>
        <span className="font-mono">{size.toLocaleString()} B</span>
      </figcaption>
    </figure>
  );
}
