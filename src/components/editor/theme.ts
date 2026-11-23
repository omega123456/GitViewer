import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
export const highlight = HighlightStyle.define([
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
        fontFeatureSettings: 'var(--font-mono--font-feature-settings)',
        fontSize: 'var(--text-diff)',
        lineHeight: 'var(--text-diff--line-height)',
      },
      '.cm-gutters': {
        backgroundColor: color('gutter', dark),
        color: color('faint', dark),
        border: 'none',
      },
      '.cm-activeLineGutter': {
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
      '.cm-panels-top': { borderBottom: `1px solid ${color('line', dark)}` },
      '.cm-panels-bottom': { borderTop: `1px solid ${color('line', dark)}` },
      '.cm-searchMatch': { backgroundColor: color('find', dark) },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: color('find-current', dark),
      },
      '.cm-tooltip': {
        backgroundColor: color('surface', dark),
        border: `1px solid ${color('line', dark)}`,
      },
    },
    { dark },
  );
}
