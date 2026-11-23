import type { PointerEvent as ReactPointerEvent } from 'react';
import { boundsOf, percentOf } from '../../lib/geometry';
import type { ResizeBounds } from '../../stores/layout';
import { handleKeyByTable } from '../../lib/keyboard';
type Orientation = 'horizontal' | 'vertical';
const arrowKeys: Record<Orientation, { back: string; forward: string }> = {
  horizontal: { back: 'ArrowLeft', forward: 'ArrowRight' },
  vertical: { back: 'ArrowUp', forward: 'ArrowDown' },
};
export function percentBelow(event: ReactPointerEvent<HTMLDivElement>) {
  const handle = event.currentTarget;
  const pane = boundsOf(handle.nextElementSibling);
  const column = boundsOf(handle.parentElement);
  return percentOf(pane.bottom - event.clientY, column.height);
}
export function clampedTo(bounds: ResizeBounds, value: number) {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}
export function ResizeHandle({
  label,
  orientation,
  bounds,
  value,
  className,
  measure,
  onChange,
}: {
  label: string;
  orientation: Orientation;
  bounds: ResizeBounds;
  value: number;
  className: string;
  measure: (event: ReactPointerEvent<HTMLDivElement>) => number;
  onChange: (value: number) => void;
}) {
  const { min, max, step } = bounds;
  const clamp = (next: number) => clampedTo(bounds, next);
  const { back, forward } = arrowKeys[orientation];
  return (
    <div
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      className={className}
      onKeyDown={(event) =>
        handleKeyByTable(event, {
          [back]: () => onChange(clamp(value - step)),
          [forward]: () => onChange(clamp(value + step)),
        })
      }
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          onChange(clamp(measure(event)));
      }}
    />
  );
}
const sectionHandle =
  'h-1.5 shrink-0 cursor-row-resize border-y border-line hover:bg-accent focus-visible:bg-accent dark:border-line-dark';
export function SectionResizeHandle({
  label,
  bounds,
  value,
  onChange,
}: {
  label: string;
  bounds: ResizeBounds;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <ResizeHandle
      label={label}
      orientation="vertical"
      bounds={bounds}
      value={value}
      className={sectionHandle}
      measure={percentBelow}
      onChange={onChange}
    />
  );
}
