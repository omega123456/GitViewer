import type { ComponentProps, ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { chooseOption } from '../../lib/options';
import { Button } from './Button';
import { menu, menuItem } from './styles';
export type SplitSize = 'regular' | 'compact';
const sizes: Record<SplitSize, { height: string; chevron: string }> = {
  regular: { height: 'h-8', chevron: 'size-3.5' },
  compact: { height: 'h-7.5', chevron: 'size-3' },
};
export function SplitButton({ children }: { children: ReactNode }) {
  return <div className="flex">{children}</div>;
}
export function SplitPrimary({
  size,
  ...props
}: ComponentProps<typeof Button> & { size: SplitSize }) {
  return (
    <Button
      variant="primary"
      className={`${sizes[size].height} min-w-0 flex-1 rounded-r-none`}
      {...props}
    />
  );
}
export function RadioMenuItem({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.RadioItem value={value} className={menuItem}>
      <span className="flex size-3 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="size-3" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.RadioItem>
  );
}
export function SplitMenu<T extends string>({
  size,
  label,
  disabled,
  side,
  width,
  value,
  options,
  onChange,
  renderOption,
}: {
  size: SplitSize;
  label: string;
  disabled: boolean;
  side?: 'top' | 'bottom';
  width: string;
  value: T;
  options: readonly T[];
  onChange: (option: T) => void;
  renderOption: (option: T) => ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="splitMenu"
          disabled={disabled}
          aria-label={label}
          className={`${sizes[size].height} w-8 rounded-l-none border-l border-on-accent/30 dark:border-on-accent-dark/30`}
        >
          <ChevronDown className={sizes[size].chevron} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          side={side}
          sideOffset={4}
          className={`${width} ${menu}`}
        >
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(next) => chooseOption(options, next, onChange)}
          >
            {options.map((option) => (
              <RadioMenuItem key={option} value={option}>
                {renderOption(option)}
              </RadioMenuItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
