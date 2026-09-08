import { Checkbox as RadixCheckbox } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { focus } from './styles';
export function CheckBox({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean | 'indeterminate';
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <RadixCheckbox.Root
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={onChange}
      className={`flex size-3.5 shrink-0 items-center justify-center rounded-xs border border-muted text-accent ${focus}`}
    >
      <RadixCheckbox.Indicator>
        {checked === 'indeterminate' ? (
          <Minus className="size-3" />
        ) : (
          <Check className="size-3" />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
