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
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Chunk } from '@codemirror/merge';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  Compartment,
  EditorState,
  Facet,
  RangeSet,
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
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
export const themeSlot = new Compartment();
export const languageSlot = new Compartment();
export const baseSlot = new Compartment();
const original = Facet.define<Text, Text>({
  combine: (values) => values[0] ?? Text.empty,
});
export function baseText(text: string | null | undefined) {
  return original.of(Text.of((text ?? '').split('\n')));
}
const highlight = HighlightStyle.define([
  { tag: tags.keyword, class: 'text-code-keyword dark:text-code-keyword-dark' },
  {
    tag: [tags.string, tags.regexp, tags.special(tags.string)],
    class: 'text-code-string dark:text-code-string-dark',
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.macroName,
    ],
    class: 'text-code-function dark:text-code-function-dark',
  },
  {
    tag: [
      tags.number,
      tags.bool,
      tags.null,
      tags.atom,
      tags.constant(tags.variableName),
      tags.standard(tags.variableName),
      tags.attributeName,
      tags.heading,
      tags.link,
    ],
    class: 'text-code-constant dark:text-code-constant-dark',
  },
  { tag: tags.comment, class: 'text-code-comment dark:text-code-comment-dark' },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    class: 'text-code-type dark:text-code-type-dark',
  },
  { tag: tags.tagName, class: 'text-code-tag dark:text-code-tag-dark' },
  { tag: tags.heading, class: 'font-semibold' },
  { tag: tags.strong, class: 'font-semibold' },
  { tag: tags.emphasis, class: 'italic' },
  { tag: tags.link, class: 'underline' },
]);
function color(name: string, dark: boolean) {
  return `var(--color-${name}${dark ? '-dark' : ''})`;
}
export function chrome(dark: boolean) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: color('surface', dark),
        color: color('ink', dark),
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-diff)',
        lineHeight: 'var(--text-diff--line-height)',
      },
      '.cm-gutters': {
        backgroundColor: color('gutter', dark),
        color: color('faint', dark),
        border: 'none',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: color('hover', dark),
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: color('ink', dark) },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
        { backgroundColor: color('selected', dark) },
      '.cm-changes': { width: '4px' },
      '.cm-panels': {
        backgroundColor: color('sub', dark),
        color: color('ink', dark),
      },
      '.cm-panels-bottom': { borderTop: `1px solid ${color('line', dark)}` },
      '.cm-tooltip': {
        backgroundColor: color('surface', dark),
        border: `1px solid ${color('line', dark)}`,
      },
    },
    { dark },
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
      return Array.from({ length: last - first + 1 }, (_, index) =>
        kind.range(doc.line(first + index).from),
      );
    }),
    true,
  );
}
interface Changes {
  chunks: readonly Chunk[];
  markers: RangeSet<GutterMarker>;
}
function build(state: EditorState): Changes {
  const chunks = Chunk.build(state.facet(original), state.doc);
  return { chunks, markers: markers(chunks, state.doc) };
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
    );
    return { chunks, markers: markers(chunks, transaction.state.doc) };
  },
});
export function describeLanguage(path: string) {
  return LanguageDescription.matchFilename(
    languages,
    path.slice(path.lastIndexOf('/') + 1),
  );
}
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
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
        {
          key: 'Escape',
          run: () => {
            leave();
            return true;
          },
        },
      ]),
      themeSlot.of(chrome(dark)),
      languageSlot.of([]),
      baseSlot.of(baseText(base)),
    ],
  });
}
