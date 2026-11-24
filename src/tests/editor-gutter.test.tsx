import type { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import {
  baseSlot,
  baseText,
  changes,
  createState,
} from '../components/editor/setup';
import { INDEX_TEXT, WORKING_TEXT } from './editor-helpers';

const EDIT_STRIDE = 5;
const LARGE_LINE_COUNT = 3000;
const MEDIUM_LINE_COUNT = 200;
const EDITED_LINE_NUMBER = 100;
const SECOND_LINE_NUMBER = 2;
const SURROGATE_START = 0xd800;

function everyFifth(line: number) {
  return line % EDIT_STRIDE === 0;
}

function generatedSource(count: number, edited: (line: number) => boolean) {
  return Array.from({ length: count }, (_unused, line) =>
    edited(line)
      ? `  return changed${line};`
      : `  const keep${line} = compute(${line});`,
  ).join('\n');
}

function editorState(text: string, base: string) {
  return createState({
    text: text,
    base: base,
    dark: false,
    leave: () => {},
  });
}

function markedLines(current: EditorState) {
  const lines: number[] = [];
  current.field(changes).markers.between(0, current.doc.length, (from) => {
    lines.push(current.doc.lineAt(from).number);
  });
  return lines;
}

function expectedLineNumbers(count: number, keep: (line: number) => boolean) {
  return Array.from({ length: count }, (_unused, line) => line)
    .filter(keep)
    .map((line) => line + 1);
}

it('keeps the gutter when the base is reconfigured with equal text', () => {
  const start = editorState(WORKING_TEXT, INDEX_TEXT);
  const same = start.update({
    effects: baseSlot.reconfigure(baseText(INDEX_TEXT)),
  }).state;
  const moved = start.update({
    effects: baseSlot.reconfigure(baseText(WORKING_TEXT)),
  }).state;
  expect(same.field(changes)).toBe(start.field(changes));
  expect(moved.field(changes)).not.toBe(start.field(changes));
  expect(moved.field(changes).chunks).toEqual([]);
});

it('marks exactly the edited lines of a file edited throughout', () => {
  const start = editorState(
    generatedSource(LARGE_LINE_COUNT, everyFifth),
    generatedSource(LARGE_LINE_COUNT, () => false),
  );
  expect(markedLines(start)).toEqual(
    expectedLineNumbers(LARGE_LINE_COUNT, everyFifth),
  );
  const typed = start.update({
    changes: { from: start.doc.line(SECOND_LINE_NUMBER).from, insert: 'x' },
  }).state;
  expect(markedLines(typed)).toEqual(
    expectedLineNumbers(
      LARGE_LINE_COUNT,
      (line) => everyFifth(line) || line === 1,
    ),
  );
});

it('compares against a CRLF base with a byte-order mark as plain lines', () => {
  const text = generatedSource(MEDIUM_LINE_COUNT, () => false);
  const base = `\uFEFF${text.replaceAll('\n', '\r\n')}`;
  const start = editorState(text, base);
  expect(markedLines(start)).toEqual([]);
  const typed = start.update({
    changes: { from: start.doc.line(EDITED_LINE_NUMBER).from, insert: 'x' },
  }).state;
  expect(markedLines(typed)).toEqual([EDITED_LINE_NUMBER]);
});

it('marks the whole file when it has more distinct lines than symbols', () => {
  const base = generatedSource(SURROGATE_START, () => false);
  const edited = editorState(base.replace('keep0 ', 'kept0 '), base);
  expect(markedLines(edited)).toEqual(
    expectedLineNumbers(SURROGATE_START, () => true),
  );
});
