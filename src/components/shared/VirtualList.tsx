import { useEffect, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { dynamic } from './styles';
export function VirtualList<T>({
  items,
  height = 26,
  render,
  label,
  onEnd,
}: {
  items: T[];
  onEnd?: () => void;
  height?: number;
  render: (item: T, index: number) => ReactNode;
  label: string;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => height,
    overscan: 12,
  });
  const last = virtual.getVirtualItems().at(-1)?.index ?? -1;
  useEffect(() => {
    if (items.length > 0 && last >= items.length - 8) onEnd?.();
  }, [last, items.length, onEnd]);
  return (
    <div
      ref={parent}
      aria-label={label}
      className="min-h-0 flex-1 overflow-auto"
    >
      <div
        className="relative h-virtual w-full"
        style={dynamic({ '--virtual-height': `${virtual.getTotalSize()}px` })}
      >
        {virtual.getVirtualItems().map((row) => (
          <div
            className="absolute top-0 left-0 w-full translate-y-row"
            key={row.key}
            style={dynamic({ '--row-offset': `${row.start}px` })}
          >
            {render(items[row.index], row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
