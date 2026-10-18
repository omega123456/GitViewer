import { RadioGroup } from 'radix-ui';
import { focus } from './styles';
const looks = {
  segmented: {
    root: 'inline-flex gap-0.5 rounded-card border border-control-stroke bg-control p-0.5 dark:border-control-stroke-dark dark:bg-control-dark',
    item: 'h-6.5 rounded px-3 hover:bg-hover aria-checked:bg-accent aria-checked:text-on-accent dark:hover:bg-hover-dark dark:aria-checked:bg-accent-dark dark:aria-checked:text-on-accent-dark',
  },
  radio: {
    root: 'flex flex-wrap gap-x-6',
    item: 'group h-8 gap-2 rounded',
  },
};
const ring =
  'size-5 shrink-0 rounded-full border border-field-edge bg-control transition-all duration-100 group-hover:bg-control-hover group-active:border-6 group-aria-checked:border-5 group-aria-checked:border-accent group-aria-checked:bg-on-accent group-aria-checked:group-hover:border-4 dark:border-field-edge-dark dark:bg-control-dark dark:group-hover:bg-control-hover-dark dark:group-aria-checked:border-accent-dark dark:group-aria-checked:bg-on-accent-dark';
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  appearance = 'segmented',
}: {
  value: T;
  options: T[];
  onChange: (value: T) => void;
  label: string;
  appearance?: keyof typeof looks;
}) {
  const look = looks[appearance];
  return (
    <RadioGroup.Root
      value={value}
      aria-label={label}
      orientation="horizontal"
      onValueChange={(next) => onChange(next as T)}
      className={look.root}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option}
          value={option}
          className={`inline-flex items-center text-sm text-ink dark:text-ink-dark ${look.item} ${focus}`}
        >
          {appearance === 'radio' && <span className={ring} />}
          <span className="inline-block whitespace-nowrap first-letter:uppercase">
            {option}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
