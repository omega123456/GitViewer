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
export function ResizeHandle({
  label,
  orientation,
  min,
  max,
  step,
  value,
  className,
  measure,
  onChange,
}: {
  label: string;
  orientation: Orientation;
  min: number;
  max: number;
  step: number;
  value: number;
  className: string;
  measure: (event: ReactPointerEvent<HTMLDivElement>) => number;
  onChange: (value: number) => void;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
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
      min={bounds.min}
      max={bounds.max}
      step={bounds.step}
      value={value}
      className={sectionHandle}
      measure={percentBelow}
      onChange={onChange}
    />
  );
}
