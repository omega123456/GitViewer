import { UNMODIFIED, UNTRACKED } from './git';
import { stepIndex } from './list';
import type { Entry, Selection, Source } from './types';
export interface ChangedFile {
  path: string;
  source: Source;
}
export interface FileStep {
  files: ChangedFile[];
  current: Selection | undefined;
  direction: number;
}
export function isStagedEntry(entry: Entry) {
  return entry.index !== UNMODIFIED && entry.index !== UNTRACKED;
}
export function hasWorktreeChange(entry: Entry) {
  return entry.worktree !== UNMODIFIED;
}
export function isDiscardable(entry: Entry) {
  return hasWorktreeChange(entry) && entry.worktree !== UNTRACKED;
}
function worktreeSource(entry: Entry): Source {
  return entry.index === UNTRACKED ? 'file' : 'unstaged';
}
function filesOf(entry: Entry): ChangedFile[] {
  const staged: ChangedFile[] = isStagedEntry(entry)
    ? [{ path: entry.path, source: 'staged' }]
    : [];
  const unstaged: ChangedFile[] = hasWorktreeChange(entry)
    ? [{ path: entry.path, source: worktreeSource(entry) }]
    : [];
  return [...staged, ...unstaged];
}
export function changedFiles(entries: Entry[], filter: string) {
  const needle = filter.toLowerCase();
  return entries
    .flatMap(filesOf)
    .filter((file) => file.path.toLowerCase().includes(needle));
}
function isCurrent(file: ChangedFile, current: Selection | undefined) {
  return file.path === current?.path && file.source === current.source;
}
export function steppedFile(step: FileStep): ChangedFile | undefined {
  const { files, current, direction } = step;
  if (!files.length) return undefined;
  const index = files.findIndex((file) => isCurrent(file, current));
  return files[stepIndex(index, direction, files.length)];
}
