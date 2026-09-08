import type { ReactNode } from 'react';
import { useImageViews, useTabImageView } from '../../stores/image-view';
import { dynamic, focus } from '../shared/styles';
export function SwipeCompare({
  repo,
  image,
}: {
  repo: string;
  image: (side: 'old' | 'new') => ReactNode;
}) {
  const { position } = useTabImageView(repo);
  const move = (value: number) =>
    useImageViews
      .getState()
      .update(repo, { position: Math.min(100, Math.max(0, value)) });
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {image('old')}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={dynamic({ '--swipe-position': `${position}%` })}
      >
        <div className="absolute inset-y-0 left-0 w-swipe overflow-hidden">
          <div
            className="flex h-full w-image items-center justify-center"
            style={dynamic({
              '--image-width': 'calc(100% * 100 / var(--swipe-number))',
              '--swipe-number': position || 0.01,
            })}
          >
            {image('new')}
          </div>
        </div>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Swipe divider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            move(position + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}
        onPointerDown={(event) =>
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            const bounds =
              event.currentTarget.parentElement!.getBoundingClientRect();
            move(((event.clientX - bounds.left) / bounds.width) * 100);
          }
        }}
        className={`absolute inset-y-0 left-swipe w-0.5 cursor-ew-resize bg-accent ${focus}`}
        style={dynamic({ '--swipe-position': `${position}%` })}
      >
        <span className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-md dark:border-surface-dark" />
      </div>
      <span className="absolute right-2 bottom-2 rounded border border-line bg-surface px-1.5 font-mono text-label text-muted dark:border-line-dark dark:bg-surface-dark">
        {Math.round(position)}%
      </span>
    </div>
  );
}
