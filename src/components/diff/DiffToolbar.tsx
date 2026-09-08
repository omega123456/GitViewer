import { Popover } from 'radix-ui';
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  EyeOff,
  MoreHorizontal,
  Rows3,
  UnfoldVertical,
  WrapText,
} from 'lucide-react';
import type { Settings } from '../../lib/types';
import { useDiffView } from '../../stores/diff-view';
import { Button } from '../shared/Button';
import { Segment } from '../shared/Segment';
const presets = [3, 10, 30];
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
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-sub px-2 dark:border-line-dark dark:bg-sub-dark">
      <Segment
        label="Diff mode"
        value={mode}
        options={['split', 'unified']}
        icons={{
          split: <Columns2 className="size-3" />,
          unified: <Rows3 className="size-3" />,
        }}
        onChange={useDiffView.getState().setMode}
      />
      <div className="ml-auto flex items-center gap-1 text-muted">
        <Button
          title="Hide whitespace"
          aria-pressed={whitespace}
          onClick={toggleWhitespace}
        >
          <EyeOff className="size-3.5" />
        </Button>
        <Button title="Word wrap" aria-pressed={wrap} onClick={toggleWrap}>
          <WrapText className="size-3.5" />
        </Button>
        <Button title="Previous change" onClick={() => move(-1)}>
          <ChevronUp className="size-3.5" />
        </Button>
        <Button title="Next change" onClick={() => move(1)}>
          <ChevronDown className="size-3.5" />
        </Button>
        <Button title="Expand context" onClick={toggleContext}>
          <UnfoldVertical className="size-3.5" />
        </Button>
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button title="Context lines">
              <MoreHorizontal className="size-3.5" />
            </Button>
          </Popover.Trigger>
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
    </div>
  );
}
