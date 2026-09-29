import { useEffect } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { shortcutLabel } from '../../lib/keyboard';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import type { Find } from './find';
export function FindBar({
  find,
  onClose,
}: {
  find: Find;
  onClose: () => void;
}) {
  const { input } = find;
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [input]);
  const close = () => {
    find.close();
    onClose();
  };
  return (
    <div
      role="search"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-sub px-2 dark:border-line-dark dark:bg-sub-dark"
    >
      <div className="w-64 shrink-0">
        <TextInput
          ref={input}
          aria-label="Find in file"
          placeholder="Find in file"
          className={`${field} py-0.5 text-xs`}
          value={find.query}
          onChange={(event) => find.search(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              find.step(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        />
      </div>
      <span
        role="status"
        className="min-w-16 shrink-0 text-label text-muted tabular-nums dark:text-muted-dark"
      >
        {find.query &&
          (find.count ? `${find.selected + 1} of ${find.count}` : 'No results')}
      </span>
      <div className="flex items-center gap-1 text-muted">
        <Button
          variant="icon"
          className="size-control"
          title={`Previous match (${shortcutLabel('Shift+F3')})`}
          aria-label="Previous match"
          disabled={!find.count}
          onClick={() => find.step(-1)}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          variant="icon"
          className="size-control"
          title={`Next match (${shortcutLabel('F3')})`}
          aria-label="Next match"
          disabled={!find.count}
          onClick={() => find.step(1)}
        >
          <ArrowDown className="size-4" />
        </Button>
      </div>
      <Button
        variant="icon"
        className="ml-auto size-control text-muted"
        title="Close find"
        aria-label="Close find"
        onClick={close}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
