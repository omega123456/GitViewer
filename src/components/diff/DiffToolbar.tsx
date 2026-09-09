import { Popover, ToggleGroup } from 'radix-ui';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Columns2,
  Pilcrow,
  Rows3,
  UnfoldVertical,
  WrapText,
} from 'lucide-react';
import type { Settings } from '../../lib/types';
import { useDiffView } from '../../stores/diff-view';
import { Button } from '../shared/Button';
import { Segment } from '../shared/Segment';
import { focus } from '../shared/styles';
const presets = [3, 10, 30];
function toggle(pressed: boolean) {
  return `grid size-control place-items-center rounded ${pressed ? 'bg-selected text-accent dark:bg-selected-dark dark:text-accent-dark' : 'text-muted'} ${focus}`;
}
function Divider() {
  return <span className="h-4 w-px shrink-0 bg-line dark:bg-line-dark" />;
}
export function DiffToolbar({
  mode,
  wrap,
  whitespace,
  context,
  setContext,
  toggleWrap,
  toggleWhitespace,
  toggleContext,
  move,
}: {
  mode: Settings['diffMode'];
  wrap: boolean;
  whitespace: boolean;
  context: number;
  setContext: (value: number) => void;
  toggleWrap: () => void;
  toggleWhitespace: () => void;
  toggleContext: () => void;
  move: (direction: number) => void;
}) {
  const pressed: string[] = [];
  if (whitespace) pressed.push('whitespace');
  if (wrap) pressed.push('wrap');
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-sub px-2 dark:border-line-dark dark:bg-sub-dark">
      <Segment
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
        onValueChange={(next) => {
          if (next.includes('whitespace') !== whitespace) toggleWhitespace();
          if (next.includes('wrap') !== wrap) toggleWrap();
        }}
        className="ml-auto inline-flex gap-0.5 rounded bg-track p-0.5 dark:bg-track-dark"
      >
        <ToggleGroup.Item
          value="whitespace"
          title="Hide whitespace"
          className={toggle(whitespace)}
        >
          <Pilcrow className="size-4" />
        </ToggleGroup.Item>
        <ToggleGroup.Item
          value="wrap"
          title="Word wrap"
          className={toggle(wrap)}
        >
          <WrapText className="size-4" />
        </ToggleGroup.Item>
      </ToggleGroup.Root>
      <Divider />
      <div className="flex items-center gap-1 text-muted">
        <Button title="Previous change" onClick={() => move(-1)}>
          <ArrowUp className="size-4" />
        </Button>
        <Button title="Next change" onClick={() => move(1)}>
          <ArrowDown className="size-4" />
        </Button>
      </div>
      <Divider />
      <Popover.Root>
        <div className="flex text-muted">
          <Button
            title="Expand context"
            aria-pressed={context !== 3}
            className={`rounded-r-none pr-1 ${context === 3 ? '' : 'bg-selected text-accent dark:bg-selected-dark dark:text-accent-dark'}`}
            onClick={toggleContext}
          >
            <UnfoldVertical className="size-4" />
          </Button>
          <Popover.Trigger asChild>
            <Button title="Context lines" className="rounded-l-none px-1">
              <ChevronDown className="size-3" />
            </Button>
          </Popover.Trigger>
        </div>
        <Popover.Portal>
          <Popover.Content
            align="end"
            className="z-30 flex flex-col rounded-md border border-line bg-surface p-1 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          >
            {presets.map((preset) => (
              <Button
                key={preset}
                aria-pressed={context === preset}
                className={`justify-start ${context === preset ? 'bg-selected dark:bg-selected-dark' : ''}`}
                onClick={() => setContext(preset)}
              >
                {preset} context lines
              </Button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
