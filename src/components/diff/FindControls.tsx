import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { shortcutLabel, type Action } from '../../lib/keyboard';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import {
  FIND_NEXT_SHORTCUT,
  FIND_PREVIOUS_SHORTCUT,
  FIND_SHORTCUT,
} from './find';
export interface FindCommands {
  reveal: () => void;
  next: () => void;
  previous: () => void;
  revealDisabled: boolean;
  stepDisabled: boolean;
}
export interface FindActionSet {
  find: Action;
  next: Action;
  previous: Action;
}
export function findActionSet(commands: FindCommands): FindActionSet {
  return {
    find: {
      id: 'find',
      icon: <Search className="size-3.5" />,
      label: 'Find in file',
      key: FIND_SHORTCUT,
      run: commands.reveal,
      disabled: commands.revealDisabled,
    },
    next: {
      id: 'find-next',
      icon: <ArrowDown className="size-3.5" />,
      label: 'Next match',
      key: FIND_NEXT_SHORTCUT,
      run: commands.next,
      disabled: commands.stepDisabled,
    },
    previous: {
      id: 'find-previous',
      icon: <ArrowUp className="size-3.5" />,
      label: 'Previous match',
      key: FIND_PREVIOUS_SHORTCUT,
      run: commands.previous,
      disabled: commands.stepDisabled,
    },
  };
}
function MatchStepButtons({
  hasMatches,
  tint,
  onPrevious,
  onNext,
}: {
  hasMatches: boolean;
  tint: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className={`flex items-center gap-1 ${tint}`}>
      <Button
        variant="icon"
        className="size-control"
        title={`Previous match (${shortcutLabel(FIND_PREVIOUS_SHORTCUT)})`}
        aria-label="Previous match"
        disabled={!hasMatches}
        onClick={onPrevious}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        variant="icon"
        className="size-control"
        title={`Next match (${shortcutLabel(FIND_NEXT_SHORTCUT)})`}
        aria-label="Next match"
        disabled={!hasMatches}
        onClick={onNext}
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  );
}
export function FindControls({
  inputRef,
  query,
  status,
  hasMatches,
  tint,
  onSearch,
  onKeyDown,
  onPrevious,
  onNext,
  onClose,
}: {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  status: ReactNode;
  hasMatches: boolean;
  tint: string;
  onSearch: (query: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="w-64 shrink-0">
        <TextInput
          ref={inputRef}
          aria-label="Find in file"
          placeholder="Find in file"
          className={`${field} h-7 text-sm`}
          value={query}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <span
        role="status"
        className="min-w-16 shrink-0 text-label text-muted tabular-nums dark:text-muted-dark"
      >
        {status}
      </span>
      <MatchStepButtons
        hasMatches={hasMatches}
        tint={tint}
        onPrevious={onPrevious}
        onNext={onNext}
      />
      <Button
        variant="icon"
        className={`ml-auto size-control ${tint}`}
        title="Close find"
        aria-label="Close find"
        onClick={onClose}
      >
        <X className="size-4" />
      </Button>
    </>
  );
}
