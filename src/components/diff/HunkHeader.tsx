import { RotateCcw, SquareMinus, SquarePlus } from 'lucide-react';
import type { Source } from '../../lib/types';
import { Button } from '../shared/Button';
export function HunkHeader({
  header,
  source,
  disabled,
  actions = true,
  stage,
  discard,
}: {
  header: string;
  source: Source;
  disabled: boolean;
  actions?: boolean;
  stage: () => void;
  discard: () => void;
}) {
  return (
    <div className="group flex h-6 items-center gap-2 border-y border-line bg-chrome px-2 text-label text-muted dark:border-line-dark dark:bg-chrome-dark">
      <span className="sticky left-2">{header}</span>
      {actions && (
        <div className="ml-auto flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          {(source === 'staged' || source === 'unstaged') && (
            <Button
              disabled={disabled}
              title={source === 'staged' ? 'Unstage hunk' : 'Stage hunk'}
              onClick={stage}
            >
              {source === 'staged' ? (
                <SquareMinus className="size-3.5" />
              ) : (
                <SquarePlus className="size-3.5" />
              )}
            </Button>
          )}
          {source === 'unstaged' && (
            <Button
              disabled={disabled}
              title="Discard hunk"
              className="hover:text-deleted dark:hover:text-deleted-dark"
              onClick={discard}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
