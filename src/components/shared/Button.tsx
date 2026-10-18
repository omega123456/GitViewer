import type { ComponentProps } from 'react';
import { focus, focusInset, standard } from './styles';
const accent = `rounded bg-accent text-on-accent enabled:hover:bg-accent/90 disabled:opacity-40 dark:bg-accent-dark dark:text-on-accent-dark dark:enabled:hover:bg-accent-dark/90 ${focus}`;
const subtle = `rounded enabled:hover:bg-hover enabled:active:bg-press disabled:opacity-40 dark:enabled:hover:bg-hover-dark dark:enabled:active:bg-press-dark ${focus}`;
const variants = {
  default: `px-2 py-1 ${subtle}`,
  command: `h-8 px-2.5 ${subtle}`,
  standard: `rounded px-2.5 py-0.75 disabled:border-control-stroke disabled:bg-track disabled:text-faint dark:disabled:border-control-stroke-dark dark:disabled:bg-track-dark dark:disabled:text-faint-dark ${standard} ${focus}`,
  icon: subtle,
  primary: `px-3.5 py-1 font-medium ${accent}`,
  splitMenu: accent,
  chrome: `disabled:opacity-40 ${focusInset}`,
};
export function Button({
  className = '',
  variant = 'default',
  children,
  ...props
}: ComponentProps<'button'> & {
  variant?: keyof typeof variants;
}) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 text-sm ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
