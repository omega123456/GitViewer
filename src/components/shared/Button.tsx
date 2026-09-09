import type { ButtonHTMLAttributes } from 'react';
import { focus, focusInset } from './styles';
const variants = {
  default: `rounded px-2 py-1 hover:bg-hover dark:hover:bg-hover-dark ${focus}`,
  primary: `rounded px-2 py-1 bg-accent text-white enabled:hover:brightness-90 ${focus}`,
  chrome: `rounded-none ${focusInset}`,
};
export function Button({
  className = '',
  variant = 'default',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
}) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 text-xs disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
