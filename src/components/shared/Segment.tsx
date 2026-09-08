import type { ReactNode } from 'react';
import { ToggleGroup } from 'radix-ui';
import { focus } from './styles';
export function Segment<T extends string>({
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
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className={`inline-flex rounded bg-chrome p-0.5 dark:bg-chrome-dark ${stretch ? 'w-full' : ''}`}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option}
          value={option}
          className={`inline-flex items-center justify-center gap-1.5 rounded px-2 py-1 text-xs ${stretch ? 'flex-1' : ''} ${value === option ? 'bg-surface shadow-sm dark:bg-surface-dark' : 'text-muted'} ${focus}`}
        >
          {icons?.[option]}
          <span className="inline-block first-letter:uppercase">{option}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
