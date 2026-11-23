import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completionKeymap,
} from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Change as DiffChange, Chunk, diff } from '@codemirror/merge';
import {
  closeSearchPanel,
  getSearchQuery,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  SearchQuery,
  searchPanelOpen,
  selectNextOccurrence,
  selectSelectionMatches,
  setSearchQuery,
} from '@codemirror/search';
import {
  Compartment,
  EditorState,
  Facet,
  RangeSet,
  StateEffect,
  StateField,
  Text,
} from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { fileName } from '../../lib/paths';
import { chrome, highlight } from './theme';
export { chrome } from './theme';
export const themeSlot = new Compartment();
export const languageSlot = new Compartment();
export const baseSlot = new Compartment();
export const wrapSlot = new Compartment();
export function wrapping(wrap: boolean, toggle: () => void) {
  return [
    wrap ? EditorView.lineWrapping : [],
    keymap.of([
      {
        key: 'Alt-z',
        run: () => {
          toggle();
          return true;
        },
      },
    ]),
  ];
}
const findHosts = new WeakMap<EditorView, HTMLElement>();
export function findHost(view: EditorView) {
  let host = findHosts.get(view);
  if (!host) {
    host = document.createElement('div');
    findHosts.set(view, host);
  }
  return host;
}
const requestFind = StateEffect.define<boolean>();
export const finding = StateField.define({
  create: () => ({ replace: false, request: 0 }),
  update: (value, transaction) =>
    transaction.effects.reduce(
      (next, effect) =>
        effect.is(requestFind)
          ? { replace: effect.value, request: next.request + 1 }
          : next,
      value,
    ),
});
const longestSeed = 100;
export function openFind(view: EditorView, replace: boolean) {
  const previous = getSearchQuery(view.state);
  if (!searchPanelOpen(view.state)) openSearchPanel(view);
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const seed =
    selected && selected.length <= longestSeed && !selected.includes('\n');
  view.dispatch({
    effects: [
      requestFind.of(replace),
      setSearchQuery.of(
        new SearchQuery({
          search: seed ? selected : previous.search,
          replace: previous.replace,
          literal: true,
        }),
      ),
    ],
  });
}
const original = Facet.define<Text, Text>({
  combine: (values) => values[0] ?? Text.empty,
  compare: (left, right) => left.eq(right),
});
export function baseText(text: string | null | undefined) {
  return original.of(
    Text.of((text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)),
  );
}
class Change extends GutterMarker {
  constructor(readonly className: string) {
    super();
  }
  eq(other: Change) {
    return other.className === this.className;
  }
  toDOM() {
    const mark = document.createElement('span');
    mark.className = this.className;
    return mark;
  }
}
const added = new Change('block h-full bg-added dark:bg-added-dark');
const modified = new Change('block h-full bg-modified dark:bg-modified-dark');
const deleted = new Change(
  'relative block h-full after:absolute after:-top-1 after:left-0 after:z-10 after:border-4 after:border-transparent after:border-l-deleted dark:after:border-l-deleted-dark',
);
function markers(chunks: readonly Chunk[], doc: Text) {
  return RangeSet.of(
    chunks.flatMap((chunk) => {
      if (chunk.fromB === chunk.toB)
        return [
          deleted.range(doc.lineAt(Math.min(chunk.fromB, doc.length)).from),
        ];
      const kind = chunk.fromA === chunk.toA ? added : modified;
      const first = doc.lineAt(chunk.fromB).number;
      const last = doc.lineAt(chunk.endB).number;
      return Array.from({ length: last - first + 1 }, (_slot, index) =>
        kind.range(doc.line(first + index).from),
      );
    }),
    true,
  );
}
const lastLineSymbol = 0xd7ff;
const buildBudgetMs = 100;
const keystrokeBudgetMs = 8;
function lineStarts(lines: string[]) {
  const starts = [0];
  for (const line of lines)
    starts.push(starts[starts.length - 1] + line.length + 1);
  return starts;
}
function diffLines(
  before: string,
  after: string,
  budget: number,
): readonly DiffChange[] {
  const linesA = before.split('\n');
  const linesB = after.split('\n');
  const symbols = new Map<string, string>();
  const encode = (lines: string[]) =>
    lines
      .map((line) => {
        let symbol = symbols.get(line);
        if (symbol === undefined) {
          symbol = String.fromCharCode(symbols.size + 1);
          symbols.set(line, symbol);
        }
        return symbol;
      })
      .join('');
  const encodedA = encode(linesA);
  const encodedB = encode(linesB);
  if (symbols.size > lastLineSymbol)
    return [new DiffChange(0, before.length, 0, after.length)];
  const startsA = lineStarts(linesA);
  const startsB = lineStarts(linesB);
  return diff(encodedA, encodedB, { timeout: budget }).map(
    (change) =>
      new DiffChange(
        Math.min(startsA[change.fromA], before.length),
        Math.min(startsA[change.toA], before.length),
        Math.min(startsB[change.fromB], after.length),
        Math.min(startsB[change.toB], after.length),
      ),
  );
}
const byLine = {
  override: (before: string, after: string) =>
    diffLines(before, after, buildBudgetMs),
};
const byLineQuickly = {
  override: (before: string, after: string) =>
    diffLines(before, after, keystrokeBudgetMs),
};
interface Changes {
  chunks: readonly Chunk[];
  markers: RangeSet<GutterMarker>;
}
function build(state: EditorState): Changes {
  const chunks = Chunk.build(state.facet(original), state.doc, byLine);
  return { chunks: chunks, markers: markers(chunks, state.doc) };
}
export const changes = StateField.define<Changes>({
  create: build,
  update: (value, transaction) => {
    const base = transaction.state.facet(original);
    if (base !== transaction.startState.facet(original))
      return build(transaction.state);
    if (!transaction.docChanged) return value;
    const chunks = Chunk.updateB(
      value.chunks,
      base,
      transaction.state.doc,
      transaction.changes,
      byLineQuickly,
    );
    return { chunks: chunks, markers: markers(chunks, transaction.state.doc) };
  },
});
export function describeLanguage(path: string) {
  return LanguageDescription.matchFilename(languages, fileName(path));
}
function editorKeymap(leave: () => void) {
  return keymap.of([
    {
      key: 'Mod-h',
      mac: 'Ctrl-h',
      run: (view) => {
        openFind(view, true);
        return true;
      },
    },
    ...closeBracketsKeymap,
    ...completionKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
    { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
    { key: 'Mod-Shift-l', run: selectSelectionMatches },
    { key: 'Mod-Alt-g', run: gotoLine },
    {
      key: 'Escape',
      run: (view) => {
        if (!closeSearchPanel(view)) leave();
        return true;
      },
    },
  ]);
}
const coreExtensions = [
  lineNumbers(),
  changes,
  gutter({
    class: 'cm-changes',
    markers: (view) => view.state.field(changes).markers,
    lineMarkerChange: (update) =>
      update.startState.field(changes) !== update.state.field(changes),
  }),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(highlight),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
  rectangularSelection(),
  crosshairCursor(),
  highlightSelectionMatches(),
  search({
    top: true,
    literal: true,
    createPanel: (view) => ({ dom: findHost(view), top: true }),
  }),
  finding,
  EditorView.contentAttributes.of({ class: 'select-text' }),
];
export function createState({
  text,
  base,
  dark,
  leave,
}: {
  text: string;
  base: string | null | undefined;
  dark: boolean;
  leave: () => void;
}) {
  return EditorState.create({
    doc: text,
    extensions: [
      ...coreExtensions,
      editorKeymap(leave),
      themeSlot.of(chrome(dark)),
      languageSlot.of([]),
      baseSlot.of(baseText(base)),
      wrapSlot.of([]),
    ],
  });
}
