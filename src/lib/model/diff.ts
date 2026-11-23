import type { Source } from './repository';
export interface Opened {
  text: string;
  version: string;
  bom: boolean;
  crlf: boolean;
}
export type Written = { saved: string } | { conflict: Opened | null };
export type LineTotals = [number, number];
export type Lines = LineTotals | null;
export type MarkRange = [number, number];
export interface LineStats {
  staged: Record<string, Lines>;
  unstaged: Record<string, Lines>;
}
export interface CommitFiles {
  statuses: Record<string, string>;
  lines: Record<string, Lines>;
}
export interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}
export interface Comparison {
  base: string;
  target: string;
  files: ChangedFile[];
}
export interface DiffLine {
  kind: string;
  content: string;
  old: number | null;
  new: number | null;
  noNewline: boolean;
  marks: MarkRange[];
}
export interface Hunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}
export interface Diff {
  path: string;
  source: Source;
  oldMode: string | null;
  newMode: string | null;
  binary: boolean;
  tooLarge: boolean;
  hunks: Hunk[];
  patches: string[];
  content: string | null;
  added: boolean;
  image: boolean;
  oldSize: number;
  newSize: number;
  oldDimensions: Dimensions | null;
  newDimensions: Dimensions | null;
}
export type StackSource =
  'unstaged' | 'staged' | 'commit' | 'stash' | 'compare';
export interface DiffStack {
  files: Record<string, Diff>;
  truncated: boolean;
}
export interface Dimensions {
  width: number;
  height: number;
}
export interface Blame {
  hash: string;
  author: string;
  timestamp: number;
  subject: string;
  line: number;
  content: string;
  block: boolean;
}
