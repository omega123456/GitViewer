import type { ReactNode } from 'react';
import { useImageViews, useTabImageView } from '../../stores/image-view';
import { dynamic, focus } from '../shared/styles';
import { boundsOf, FULL_PERCENT, percentOf } from '../../lib/geometry';
import { handleKeyByTable } from '../../lib/keyboard';
const MINIMUM_SWIPE_POSITION = 0.01;
function SwipeDivider({
  position,
  onMove,
}: {
  position: number;
  onMove: (value: number) => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Swipe divider"
      aria-valuemin={0}
      aria-valuemax={FULL_PERCENT}
      aria-valuenow={Math.round(position)}
      onKeyDown={(event) =>
        handleKeyByTable(event, {
          ArrowLeft: () => onMove(position - 1),
          ArrowRight: () => onMove(position + 1),
        })
      }
      onPointerDown={(event) =>
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = boundsOf(event.currentTarget.parentElement);
        onMove(percentOf(event.clientX - bounds.left, bounds.width));
      }}
      className={`absolute inset-y-0 left-swipe w-0.5 cursor-ew-resize bg-accent ${focus}`}
      style={dynamic({ '--swipe-position': `${position}%` })}
    >
      <span className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-md dark:border-surface-dark" />
    </div>
  );
}
export function SwipeCompare({
  view,
  image,
}: {
  view: string;
  image: (side: 'old' | 'new') => ReactNode;
}) {
  const { position } = useTabImageView(view);
  const move = (value: number) =>
    useImageViews
      .getState()
      .update(view, { position: Math.min(FULL_PERCENT, Math.max(0, value)) });
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
              '--swipe-number': position || MINIMUM_SWIPE_POSITION,
            })}
          >
            {image('new')}
          </div>
        </div>
      </div>
      <SwipeDivider position={position} onMove={move} />
      <span className="absolute right-2 bottom-2 rounded border border-line bg-surface px-1.5 font-mono text-badge text-muted dark:border-line-dark dark:bg-surface-dark">
        {Math.round(position)}%
      </span>
    </div>
  );
}
