import { Switch } from 'radix-ui';
import { focus } from './styles';
export function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className="inline-flex items-center gap-3 text-sm text-muted dark:text-muted-dark">
      <span aria-hidden="true">{checked ? 'On' : 'Off'}</span>
      <Switch.Root
        checked={checked}
        aria-label={label}
        onCheckedChange={onChange}
        className={`group flex h-5 w-10 shrink-0 items-center rounded-full border border-field-edge bg-control hover:bg-control-hover aria-checked:border-accent aria-checked:bg-accent dark:border-field-edge-dark dark:bg-control-dark dark:hover:bg-control-hover-dark dark:aria-checked:border-accent-dark dark:aria-checked:bg-accent-dark ${focus}`}
      >
        <Switch.Thumb className="block size-3 translate-x-0.75 rounded-full bg-muted transition-transform duration-100 group-aria-checked:translate-x-5.75 group-aria-checked:bg-on-accent dark:bg-muted-dark dark:group-aria-checked:bg-on-accent-dark" />
      </Switch.Root>
    </span>
  );
}
