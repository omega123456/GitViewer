import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from './Button';
import { focus } from './styles';
export const createModes = { switch: 'Create & switch', stay: 'Create only' };
export type CreateMode = keyof typeof createModes;
const item = `flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs outline-none data-disabled:opacity-40 data-highlighted:bg-hover dark:data-highlighted:bg-hover-dark ${focus}`;
export function CreateButton({
  mode,
  disabled,
  optionsLabel,
  onMode,
}: {
  mode: CreateMode;
  disabled: boolean;
  optionsLabel: string;
  onMode: (mode: CreateMode) => void;
}) {
  return (
    <div className="flex">
      <Button
        type="submit"
        variant="primary"
        disabled={disabled}
        className="h-7 rounded-r-none px-3 font-medium"
      >
        {createModes[mode]}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="primary"
            disabled={disabled}
            aria-label={optionsLabel}
            className="h-7 rounded-l-none border-l border-white/30 dark:border-surface-dark/30"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 flex w-40 flex-col rounded-md border border-line bg-surface p-1 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          >
            <DropdownMenu.RadioGroup
              value={mode}
              onValueChange={(value) => onMode(value as CreateMode)}
            >
              {(Object.keys(createModes) as CreateMode[]).map((option) => (
                <DropdownMenu.RadioItem
                  key={option}
                  value={option}
                  className={item}
                >
                  <span className="flex size-3 items-center justify-center">
                    <DropdownMenu.ItemIndicator>
                      <Check className="size-3" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {createModes[option]}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
