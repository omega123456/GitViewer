import { useEffect, type KeyboardEvent } from 'react';
import type { Action } from '../../lib/keyboard';
import type { Find } from './find';
import { findActionSet, FindControls } from './FindControls';
const NEXT = 1;
const PREVIOUS = -1;
export function findActions(find: Find, unavailable: boolean): Action[] {
  const actions = findActionSet({
    reveal: find.reveal,
    next: () => find.step(NEXT),
    previous: () => find.step(PREVIOUS),
    revealDisabled: unavailable,
    stepDisabled: unavailable || !find.open || !find.count,
  });
  return [actions.find, actions.next, actions.previous];
}
function findStatus(find: Find) {
  if (!find.count) return 'No results';
  return `${find.selected + 1} of ${find.count}`;
}
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
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      find.step(event.shiftKey ? PREVIOUS : NEXT);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  return (
    <div
      role="search"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-sub px-2 dark:border-line-dark dark:bg-sub-dark"
    >
      <FindControls
        inputRef={input}
        query={find.query}
        status={find.query && findStatus(find)}
        hasMatches={Boolean(find.count)}
        tint="text-muted"
        onSearch={find.search}
        onKeyDown={keys}
        onPrevious={() => find.step(PREVIOUS)}
        onNext={() => find.step(NEXT)}
        onClose={close}
      />
    </div>
  );
}
