import type { PointerEvent as ReactPointerEvent } from 'react';
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
  orientation: 'horizontal' | 'vertical';
  min: number;
  max: number;
  step: number;
  value: number;
  className: string;
  measure: (event: ReactPointerEvent<HTMLDivElement>) => number;
  onChange: (value: number) => void;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const [back, forward] =
    orientation === 'horizontal'
      ? ['ArrowLeft', 'ArrowRight']
      : ['ArrowUp', 'ArrowDown'];
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
      onKeyDown={(event) => {
        if (event.key === back || event.key === forward)
          onChange(clamp(value + (event.key === forward ? step : -step)));
      }}
      onPointerDown={(event) =>
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          onChange(clamp(measure(event)));
      }}
    />
  );
}
