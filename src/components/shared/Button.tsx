import type { ButtonHTMLAttributes } from 'react';
import { focus } from './styles';
export function Button({
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-hover disabled:opacity-40 dark:hover:bg-hover-dark ${focus} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
