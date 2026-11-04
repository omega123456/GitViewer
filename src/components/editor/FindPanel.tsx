import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
import {
  EditorSelection,
  type EditorState,
  type Text,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { platform } from '@tauri-apps/plugin-os';
import { matches as pressed, shortcutLabel } from '../../lib/keyboard';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import { findHost, finding, openFind } from './setup';
const replaceShortcut = () => (platform() === 'macos' ? 'Ctrl+h' : 'Mod+h');
interface Match {
  from: number;
  to: number;
}
function allMatches(query: SearchQuery, doc: Text) {
  const matches: Match[] = [];
  if (!query.valid) return matches;
  const cursor = query.getCursor(doc);
  for (let next = cursor.next(); !next.done; next = cursor.next())
    matches.push(next.value);
  return matches;
}
function nearest(query: SearchQuery, state: EditorState) {
  if (!query.valid) return undefined;
  const after = query.getCursor(state, state.selection.main.from).next();
  if (!after.done) return after.value;
  const first = query.getCursor(state).next();
  return first.done ? undefined : first.value;
}
export function FindPanel({
  view,
  state,
}: {
  view: EditorView;
  state: EditorState;
}) {
  if (!searchPanelOpen(state)) return null;
  return createPortal(<Panel view={view} state={state} />, findHost(view));
}
function Panel({ view, state }: { view: EditorView; state: EditorState }) {
  const searchField = useRef<HTMLInputElement>(null);
  const replaceField = useRef<HTMLInputElement>(null);
  const query = getSearchQuery(state);
  const { replace, request } = state.field(finding);
  const doc = state.doc;
  const matches = useMemo(() => allMatches(query, doc), [query, doc]);
  const { from, to } = state.selection.main;
  const current = matches.findIndex(
    (match) => match.from === from && match.to === to,
  );
  const seeded = Boolean(query.search);
  const handled = useRef(0);
  useEffect(() => {
    if (handled.current === request) return;
    handled.current = request;
    const target =
      replace && seeded ? replaceField.current : searchField.current;
    target?.focus();
    target?.select();
  }, [request, replace, seeded]);
  const update = (search: string, replacement: string) => {
    const next = new SearchQuery({
      search,
      replace: replacement,
      literal: true,
    });
    const match = search === query.search ? undefined : nearest(next, state);
    view.dispatch({
      effects: [
        setSearchQuery.of(next),
        ...(match
          ? [EditorView.scrollIntoView(match.from, { y: 'center' })]
          : []),
      ],
      selection: match && EditorSelection.single(match.from, match.to),
    });
  };
  const close = () => closeSearchPanel(view);
  const keys = (event: KeyboardEvent, enter: () => void) => {
    if (pressed(event.nativeEvent, replaceShortcut())) {
      event.preventDefault();
      openFind(view, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      enter();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  return (
    <div role="search" className="flex flex-col gap-1.5 px-2 py-1">
      <div className="flex h-7 items-center gap-2">
        <div className="w-64 shrink-0">
          <TextInput
            ref={searchField}
            aria-label="Find in file"
            placeholder="Find in file"
            className={`${field} h-7 text-sm`}
            value={query.search}
            onChange={(event) => update(event.target.value, query.replace)}
            onKeyDown={(event) =>
              keys(event, () =>
                (event.shiftKey ? findPrevious : findNext)(view),
              )
            }
          />
        </div>
        <span
          role="status"
          className="min-w-16 shrink-0 text-label text-muted tabular-nums dark:text-muted-dark"
        >
          {query.search &&
            (!matches.length
              ? 'No results'
              : current >= 0
                ? `${current + 1} of ${matches.length}`
                : `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`)}
        </span>
        <div className="flex items-center gap-1 text-muted dark:text-muted-dark">
          <Button
            variant="icon"
            className="size-control"
            title={`Previous match (${shortcutLabel('Shift+F3')})`}
            aria-label="Previous match"
            disabled={!matches.length}
            onClick={() => findPrevious(view)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="icon"
            className="size-control"
            title={`Next match (${shortcutLabel('F3')})`}
            aria-label="Next match"
            disabled={!matches.length}
            onClick={() => findNext(view)}
          >
            <ArrowDown className="size-4" />
          </Button>
        </div>
        <Button
          variant="icon"
          className="ml-auto size-control text-muted dark:text-muted-dark"
          title="Close find"
          aria-label="Close find"
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>
      {replace && (
        <div className="flex h-7 items-center gap-2">
          <div className="w-64 shrink-0">
            <TextInput
              ref={replaceField}
              aria-label="Replace with"
              placeholder="Replace with"
              className={`${field} h-7 text-sm`}
              value={query.replace}
              onChange={(event) => update(query.search, event.target.value)}
              onKeyDown={(event) => keys(event, () => replaceNext(view))}
            />
          </div>
          <Button
            variant="standard"
            disabled={!matches.length}
            onClick={() => replaceNext(view)}
          >
            Replace
          </Button>
          <Button
            variant="standard"
            disabled={!matches.length}
            onClick={() => replaceAll(view)}
          >
            Replace all
          </Button>
        </div>
      )}
    </div>
  );
}
