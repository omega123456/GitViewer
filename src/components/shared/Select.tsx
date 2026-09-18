import { Select as RadixSelect } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { focus } from './styles';
export function Select({
  value,
  options,
  label,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  label: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <RadixSelect.Root
      value={value || undefined}
      disabled={disabled}
      onValueChange={onChange}
    >
      <RadixSelect.Trigger
        aria-label={label}
        className={`flex w-full items-center gap-2 rounded border border-line bg-surface px-2 py-1 text-xs disabled:opacity-40 dark:border-line-dark dark:bg-surface-dark ${focus}`}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="ml-auto text-muted">
          <ChevronDown className="size-3.5" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-40 overflow-hidden rounded-md border border-line bg-surface text-ink shadow-xl dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option}
                value={option}
                className={`flex items-center gap-2 rounded px-2 py-1 font-mono text-label data-highlighted:bg-hover data-highlighted:outline-none dark:data-highlighted:bg-hover-dark ${focus}`}
              >
                <span className="flex size-3 shrink-0 items-center justify-center text-accent dark:text-accent-dark">
                  <RadixSelect.ItemIndicator>
                    <Check className="size-3" />
                  </RadixSelect.ItemIndicator>
                </span>
                <RadixSelect.ItemText>{option}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
