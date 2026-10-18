import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from './Button';
import { menu, menuItem } from './styles';
export const createModes = { switch: 'Create & switch', stay: 'Create only' };
export type CreateMode = keyof typeof createModes;
export function CreateButton({
  mode,
  disabled,
  optionsLabel,
  form,
  onMode,
}: {
  mode: CreateMode;
  disabled: boolean;
  optionsLabel: string;
  form: string;
  onMode: (mode: CreateMode) => void;
}) {
  return (
    <div className="flex">
      <Button
        type="submit"
        form={form}
        variant="primary"
        disabled={disabled}
        className="h-8 min-w-0 flex-1 rounded-r-none"
      >
        {createModes[mode]}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="splitMenu"
            disabled={disabled}
            aria-label={optionsLabel}
            className="h-8 w-8 rounded-l-none border-l border-on-accent/30 dark:border-on-accent-dark/30"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className={`w-44 ${menu}`}
          >
            <DropdownMenu.RadioGroup
              value={mode}
              onValueChange={(value) => onMode(value as CreateMode)}
            >
              {(Object.keys(createModes) as CreateMode[]).map((option) => (
                <DropdownMenu.RadioItem
                  key={option}
                  value={option}
                  className={menuItem}
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
