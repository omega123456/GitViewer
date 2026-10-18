import type { KeyboardEvent, ReactNode } from 'react';
import { focus } from './styles';
export const tabSteps: Record<
  string,
  (index: number, count: number) => number
> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};
const selected =
  'font-semibold text-ink after:absolute after:bottom-px after:left-1/2 after:h-0.75 after:w-4 after:-translate-x-1/2 after:rounded-xs after:bg-accent dark:text-ink-dark dark:after:bg-accent-dark';
export function ViewSwitch<T extends string>({
  value,
  options,
  onChange,
  label,
  icons,
  stretch,
}: {
  value: T;
  options: T[];
  onChange: (value: T) => void;
  label: string;
  icons?: Partial<Record<T, ReactNode>>;
  stretch?: boolean;
}) {
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = tabSteps[event.key];
    if (!step) return;
    event.preventDefault();
    const index = step(Math.max(options.indexOf(value), 0), options.length);
    onChange(options[index]);
    const tabs =
      event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs[index]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={keydown}
      className={
        stretch
          ? 'flex min-w-0 gap-0.5'
          : 'inline-grid auto-cols-fr grid-flow-col gap-0.5'
      }
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={value === option}
          tabIndex={value === option ? 0 : -1}
          onClick={() => onChange(option)}
          className={`relative inline-flex items-center justify-center gap-1.5 rounded text-sm hover:bg-hover active:bg-press dark:hover:bg-hover-dark dark:active:bg-press-dark ${stretch ? 'h-8.5 min-w-max flex-1 basis-0 px-1' : 'h-8 px-2.5'} ${value === option ? selected : 'text-muted dark:text-muted-dark'} ${focus}`}
        >
          {icons?.[option]}
          <span className="inline-grid whitespace-nowrap *:col-start-1 *:row-start-1 *:first-letter:uppercase">
            <span aria-hidden className="invisible font-semibold">
              {option}
            </span>
            <span>{option}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
