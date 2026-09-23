import { Loader2 } from 'lucide-react';
export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <Loader2
      className={`shrink-0 animate-spin motion-reduce:animate-none ${className}`}
    />
  );
}
