import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
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
import { handleKeyByTable, matches as pressed } from '../../lib/keyboard';
import { plural } from '../../lib/text';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import { findHost, finding, openFind } from './setup';
import { FindControls } from '../diff/FindControls';
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
function matchStatus(count: number, current: number) {
  if (!count) return 'No results';
  if (current >= 0) return `${current + 1} of ${count}`;
  return plural(count, 'result');
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
function updateSearchQuery({
  view,
  state,
  previous,
  search,
  replacement,
}: {
  view: EditorView;
  state: EditorState;
  previous: SearchQuery;
  search: string;
  replacement: string;
}) {
  const next = new SearchQuery({
    search: search,
    replace: replacement,
    literal: true,
  });
  const match = search === previous.search ? undefined : nearest(next, state);
  view.dispatch({
    effects: [
      setSearchQuery.of(next),
      ...(match
        ? [EditorView.scrollIntoView(match.from, { y: 'center' })]
        : []),
    ],
    selection: match && EditorSelection.single(match.from, match.to),
  });
}
function ReplaceRow({
  inputRef,
  value,
  hasMatches,
  onChange,
  onKeyDown,
  onReplace,
  onReplaceAll,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  hasMatches: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
}) {
  return (
    <div className="flex h-7 items-center gap-2">
      <div className="w-64 shrink-0">
        <TextInput
          ref={inputRef}
          aria-label="Replace with"
          placeholder="Replace with"
          className={`${field} h-7 text-sm`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <Button variant="standard" disabled={!hasMatches} onClick={onReplace}>
        Replace
      </Button>
      <Button variant="standard" disabled={!hasMatches} onClick={onReplaceAll}>
        Replace all
      </Button>
    </div>
  );
}
function useFocusFindField(
  request: number,
  focusReplace: boolean,
  fields: {
    search: RefObject<HTMLInputElement | null>;
    replace: RefObject<HTMLInputElement | null>;
  },
) {
  const handled = useRef(0);
  useEffect(() => {
    if (handled.current === request) return;
    handled.current = request;
    const target = focusReplace
      ? fields.replace.current
      : fields.search.current;
    target?.focus();
    target?.select();
  }, [request, focusReplace, fields.replace, fields.search]);
}
function handleFindKeys(
  event: KeyboardEvent,
  handlers: { view: EditorView; enter: () => void; close: () => void },
) {
  if (pressed(event.nativeEvent, replaceShortcut())) {
    event.preventDefault();
    openFind(handlers.view, true);
    return;
  }
  handleKeyByTable(event, { Enter: handlers.enter, Escape: handlers.close });
}
function useCurrentMatches(query: SearchQuery, state: EditorState) {
  const doc = state.doc;
  const matches = useMemo(() => allMatches(query, doc), [query, doc]);
  const { from, to } = state.selection.main;
  const current = matches.findIndex(
    (match) => match.from === from && match.to === to,
  );
  return { matches, current };
}
function findKeyHandlers(view: EditorView, close: () => void) {
  return {
    onSearchKey: (event: KeyboardEvent) =>
      handleFindKeys(event, {
        view: view,
        enter: () => (event.shiftKey ? findPrevious : findNext)(view),
        close: close,
      }),
    onReplaceKey: (event: KeyboardEvent) =>
      handleFindKeys(event, {
        view: view,
        enter: () => replaceNext(view),
        close: close,
      }),
  };
}
function Panel({ view, state }: { view: EditorView; state: EditorState }) {
  const searchField = useRef<HTMLInputElement>(null);
  const replaceField = useRef<HTMLInputElement>(null);
  const query = getSearchQuery(state);
  const { replace, request } = state.field(finding);
  const { matches, current } = useCurrentMatches(query, state);
  useFocusFindField(request, replace && Boolean(query.search), {
    search: searchField,
    replace: replaceField,
  });
  const update = (search: string, replacement: string) =>
    updateSearchQuery({
      view: view,
      state: state,
      previous: query,
      search: search,
      replacement: replacement,
    });
  const close = () => closeSearchPanel(view);
  const { onSearchKey, onReplaceKey } = findKeyHandlers(view, close);
  return (
    <div role="search" className="flex flex-col gap-1.5 px-2 py-1">
      <div className="flex h-7 items-center gap-2">
        <FindControls
          inputRef={searchField}
          query={query.search}
          status={query.search && matchStatus(matches.length, current)}
          hasMatches={matches.length > 0}
          tint="text-muted dark:text-muted-dark"
          onSearch={(search) => update(search, query.replace)}
          onKeyDown={onSearchKey}
          onPrevious={() => findPrevious(view)}
          onNext={() => findNext(view)}
          onClose={close}
        />
      </div>
      {replace && (
        <ReplaceRow
          inputRef={replaceField}
          value={query.replace}
          hasMatches={matches.length > 0}
          onChange={(replacement) => update(query.search, replacement)}
          onKeyDown={onReplaceKey}
          onReplace={() => replaceNext(view)}
          onReplaceAll={() => replaceAll(view)}
        />
      )}
    </div>
  );
}
