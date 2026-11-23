import type { ReactNode } from 'react';
import { dynamic } from './styles';
const canvas = 'relative h-virtual';
export function VirtualCanvas({
  height,
  className,
  children,
}: {
  height: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className ? `${canvas} ${className}` : canvas}
      style={dynamic({ '--virtual-height': `${height}px` })}
    >
      {children}
    </div>
  );
}
