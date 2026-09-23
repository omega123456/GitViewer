import type { ReactNode } from 'react';
import { Select as RadixSelect } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { focus } from './styles';
export function Select({
  value,
  options = [],
  groups = [{ label: '', options }],
  badges = {},
  icon,
  label,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  options?: string[];
  groups?: { label: string; options: string[] }[];
  badges?: Partial<Record<string, string>>;
  icon?: ReactNode;
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
        className={`flex h-7 w-full items-center gap-2 rounded border border-line bg-surface px-2 text-xs disabled:opacity-40 dark:border-line-dark dark:bg-surface-dark ${focus}`}
      >
        {icon}
        <RadixSelect.Value
          placeholder={placeholder}
          className="flex min-w-0 items-center gap-2"
        >
          <span className="truncate font-mono">{value}</span>
          {badges[value] && (
            <span className="shrink-0 rounded-full bg-selected px-1.5 text-label font-semibold tracking-wide text-accent uppercase dark:bg-selected-dark dark:text-accent-dark">
              {badges[value]}
            </span>
          )}
        </RadixSelect.Value>
        <RadixSelect.Icon className="ml-auto shrink-0 text-muted dark:text-muted-dark">
          <ChevronDown className="size-3.5" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-select-height w-select-width overflow-hidden rounded-md border border-line bg-surface text-ink shadow-xl dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
        >
          <RadixSelect.Viewport className="p-1">
            {groups.map((group) => (
              <RadixSelect.Group key={group.label}>
                {group.label && (
                  <RadixSelect.Label className="px-2 pt-1.5 pb-0.5 text-label font-semibold tracking-wider text-faint uppercase dark:text-faint-dark">
                    {group.label}
                  </RadixSelect.Label>
                )}
                {group.options.map((option) => (
                  <RadixSelect.Item
                    key={option}
                    value={option}
                    className={`flex items-center gap-2 rounded px-2 py-1 font-mono text-xs data-highlighted:bg-hover data-highlighted:outline-none dark:data-highlighted:bg-hover-dark ${focus}`}
                  >
                    <span className="flex size-3 shrink-0 items-center justify-center text-accent dark:text-accent-dark">
                      <RadixSelect.ItemIndicator>
                        <Check className="size-3" />
                      </RadixSelect.ItemIndicator>
                    </span>
                    <RadixSelect.ItemText className="min-w-0 truncate">
                      {option}
                    </RadixSelect.ItemText>
                    {badges[option] && (
                      <span className="ml-auto shrink-0 pl-3 font-sans text-label text-faint dark:text-faint-dark">
                        {badges[option]}
                      </span>
                    )}
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Group>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
