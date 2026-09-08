import type { ButtonHTMLAttributes } from 'react';
import { focus } from './styles';
export function Button({
  className = '',
  variant = 'default',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary';
}) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs disabled:opacity-40 ${variant === 'primary' ? 'bg-accent text-white enabled:hover:brightness-90' : 'hover:bg-hover dark:hover:bg-hover-dark'} ${focus} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
