import type { ReactNode } from 'react';
import { Select as RadixSelect } from 'radix-ui';
import { ChevronDown } from 'lucide-react';
import { chooseOption } from '../../lib/options';
import { clickable, focus, flyout, pill, selectItem, standard } from './styles';
export function Select<T extends string>({
  value,
  options = [],
  groups = [{ label: '', options: options }],
  badges = {},
  labels = {},
  icon,
  label,
  placeholder,
  mono,
  disabled,
  onChange,
}: {
  value: T;
  options?: T[];
  groups?: { label: string; options: T[] }[];
  badges?: Partial<Record<T, string>>;
  labels?: Partial<Record<T, string>>;
  icon?: ReactNode;
  label: string;
  placeholder: string;
  mono?: boolean;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const choices = groups.flatMap((group) => group.options);
  return (
    <RadixSelect.Root
      value={value || undefined}
      disabled={disabled}
      onValueChange={(next) => chooseOption(choices, next, onChange)}
    >
      <RadixSelect.Trigger
        aria-label={label}
        className={`flex h-8 w-full items-center gap-2 rounded px-2.5 text-sm disabled:opacity-40 *:min-w-0 ${clickable} ${standard} ${focus}`}
      >
        {icon}
        <RadixSelect.Value placeholder={placeholder}>
          <span className="flex min-w-0 items-center gap-2">
            <span className={`truncate ${mono ? 'font-mono text-diff' : ''}`}>
              {labels[value] ?? value}
            </span>
            {badges[value] && (
              <span className="shrink-0 rounded-full bg-selected px-1.5 text-label font-semibold text-accent dark:bg-selected-dark dark:text-accent-dark">
                {badges[value]}
              </span>
            )}
          </span>
        </RadixSelect.Value>
        <RadixSelect.Icon className="ml-auto shrink-0 text-muted dark:text-muted-dark">
          <ChevronDown className="size-3" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={`z-50 max-h-select-height w-select-width overflow-hidden ${flyout}`}
        >
          <RadixSelect.Viewport className="py-0.5">
            {groups.map((group) => (
              <RadixSelect.Group key={group.label}>
                {group.label && (
                  <RadixSelect.Label className="px-3.5 pt-1.5 pb-0.5 text-label font-semibold text-muted dark:text-muted-dark">
                    {group.label}
                  </RadixSelect.Label>
                )}
                {group.options.map((option) => (
                  <RadixSelect.Item
                    key={option}
                    value={option}
                    className={`${selectItem} ${mono ? 'font-mono text-diff' : ''} ${option === value ? 'bg-selected dark:bg-selected-dark' : ''}`}
                  >
                    {option === value && <span className={pill} />}
                    <span className="min-w-0 truncate">
                      <RadixSelect.ItemText>
                        {labels[option] ?? option}
                      </RadixSelect.ItemText>
                    </span>
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
