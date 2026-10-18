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
      className={`flex size-5 shrink-0 items-center justify-center rounded border text-on-accent disabled:opacity-40 dark:text-on-accent-dark ${checked ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark' : 'border-field-edge bg-control dark:border-field-edge-dark dark:bg-control-dark'} ${focus}`}
    >
      <RadixCheckbox.Indicator>
        {checked === 'indeterminate' ? (
          <Minus className="size-3.25" strokeWidth={2.2} />
        ) : (
          <Check className="size-3.25" strokeWidth={2.2} />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
