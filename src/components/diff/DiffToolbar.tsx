import { ToggleGroup } from 'radix-ui';
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  Pilcrow,
  Rows3,
  UnfoldVertical,
  WrapText,
} from 'lucide-react';
import type { Settings } from '../../lib/types';
import { useDiffView } from '../../stores/diff-view';
import { Button } from '../shared/Button';
import { ViewSwitch } from '../shared/ViewSwitch';
import { clickable, focus, accentToggle } from '../shared/styles';
function toggle(pressed: boolean) {
  return `grid size-control place-items-center rounded ${pressed ? accentToggle : 'text-muted hover:bg-hover dark:text-muted-dark dark:hover:bg-hover-dark'} ${clickable} ${focus}`;
}
export function FullFileButton({
  full,
  toggle,
}: {
  full: boolean;
  toggle: () => void;
}) {
  return (
    <Button
      title={full ? 'Collapse to changes' : 'Show full file'}
      aria-pressed={full}
      variant="icon"
      className={`size-control ${
        full ? accentToggle : 'text-muted dark:text-muted-dark'
      }`}
      onClick={toggle}
    >
      <UnfoldVertical className="size-3.5" />
    </Button>
  );
}
type DisplayOption = 'whitespace' | 'wrap';
const displayToggles: {
  value: DisplayOption;
  title: string;
  icon: typeof Pilcrow;
}[] = [
  { value: 'whitespace', title: 'Hide whitespace', icon: Pilcrow },
  { value: 'wrap', title: 'Word wrap', icon: WrapText },
];
interface DisplayToggle {
  pressed: boolean;
  toggle: () => void;
}
function Divider() {
  return (
    <span className="mx-1.5 h-5 w-px shrink-0 bg-line dark:bg-line-dark" />
  );
}
export function DiffToolbar({
  mode,
  wrap,
  whitespace,
  full,
  toggleWrap,
  toggleWhitespace,
  toggleFull,
  move,
}: {
  mode: Settings['diffMode'];
  wrap: boolean;
  whitespace: boolean;
  full?: boolean;
  toggleWrap: () => void;
  toggleWhitespace: () => void;
  toggleFull: () => void;
  move: (direction: number) => void;
}) {
  const display: Record<DisplayOption, DisplayToggle> = {
    whitespace: { pressed: whitespace, toggle: toggleWhitespace },
    wrap: { pressed: wrap, toggle: toggleWrap },
  };
  const pressed = displayToggles
    .filter(({ value }) => display[value].pressed)
    .map(({ value }) => value);
  const applyPressed = (next: string[]) => {
    for (const { value } of displayToggles) {
      const option = display[value];
      if (next.includes(value) !== option.pressed) option.toggle();
    }
  };
  return (
    <div className="flex h-9.5 shrink-0 items-center gap-1 border-b border-line bg-surface px-2.5 dark:border-line-dark dark:bg-surface-dark">
      <ViewSwitch
        label="Diff mode"
        value={mode}
        options={['split', 'unified']}
        icons={{
          split: <Columns2 className="size-4" />,
          unified: <Rows3 className="size-4" />,
        }}
        onChange={useDiffView.getState().setMode}
      />
      <ToggleGroup.Root
        type="multiple"
        aria-label="Diff display"
        value={pressed}
        onValueChange={applyPressed}
        className="ml-auto inline-flex gap-1"
      >
        {displayToggles.map(({ value, title, icon: Icon }) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            title={title}
            className={toggle(display[value].pressed)}
          >
            <Icon className="size-3.5" />
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
      <Divider />
      <div className="flex items-center gap-1 text-muted dark:text-muted-dark">
        <Button
          variant="icon"
          className="size-control"
          title="Previous change"
          onClick={() => move(-1)}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          variant="icon"
          className="size-control"
          title="Next change"
          onClick={() => move(1)}
        >
          <ArrowDown className="size-3.5" />
        </Button>
      </div>
      {full !== undefined && (
        <>
          <Divider />
          <FullFileButton full={full} toggle={toggleFull} />
        </>
      )}
    </div>
  );
}
