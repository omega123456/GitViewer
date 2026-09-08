import type { Entry, Source, TreeEntry } from '../../lib/types';
export const treeRoot = '\0';
export function statusLetter(status: string) {
  return status === '?' ? 'U' : status;
}
export function statusClass(status: string) {
  if (status === 'A') return 'text-added dark:text-added-dark';
  if (status === 'D') return 'text-deleted dark:text-deleted-dark';
  if (status === 'C') return 'text-deleted opacity-50 dark:text-deleted-dark';
  if (status === 'M') return 'text-modified dark:text-modified-dark';
  return 'text-untracked dark:text-untracked-dark';
}
export function sourceFor(entry?: Entry): Source {
  if (!entry || entry.index === '?') return 'file';
  return entry.worktree !== '.'
    ? 'unstaged'
    : entry.index !== '.'
      ? 'staged'
      : 'file';
}
export interface Node extends TreeEntry {
  children: string[];
  paths: string[];
  partial: boolean;
}
export function changeNodes(
  entries: Entry[],
  source: 'staged' | 'unstaged',
  filter: string,
) {
  const map: Record<string, Node> = Object.create(null);
  map[treeRoot] = {
    path: '',
    name: '',
    directory: true,
    ignored: false,
    status: '',
    children: [],
    paths: [],
    partial: false,
  };
  const selected = entries
    .filter((entry) =>
      source === 'staged'
        ? entry.index !== '.' && entry.index !== '?'
        : entry.worktree !== '.',
    )
    .filter((entry) => entry.path.toLowerCase().includes(filter.toLowerCase()));
  for (const entry of selected) {
    const parts = entry.path.split('/');
    let parent = treeRoot;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      if (!map[path]) {
        map[path] = {
          path,
          name: part,
          directory: index < parts.length - 1,
          ignored: false,
          status:
            index === parts.length - 1
              ? source === 'staged'
                ? entry.index
                : entry.worktree
              : '',
          children: [],
          paths: [],
          partial: false,
        };
        map[parent].children.push(path);
      }
      map[path].paths.push(entry.path);
      map[path].partial ||=
        entry.index !== '.' && entry.index !== '?' && entry.worktree !== '.';
      parent = path;
    });
  }
  return map;
}
