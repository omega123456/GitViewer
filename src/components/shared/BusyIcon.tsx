import type { LucideIcon } from 'lucide-react';
import { Spinner } from './Spinner';
export function BusyIcon({
  busy,
  icon: Icon,
  className = 'size-4',
}: {
  busy: boolean;
  icon: LucideIcon;
  className?: string;
}) {
  if (busy) return <Spinner className={className} />;
  return <Icon className={className} />;
}
