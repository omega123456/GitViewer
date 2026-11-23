import { useEffect, useRef } from 'react';
import type { TreeInstance } from '@headless-tree/core';
import type {
  Entry,
  Lines,
  LineTotals,
  Source,
  Status,
  TreeEntry,
} from '../../lib/types';
import type { Group } from '../../stores/selection';
import { UNTRACKED, UNMODIFIED } from '../../lib/git';
import { addedInk, removedInk } from '../shared/styles';
export const treeRoot = '\0';
export function statusLetter(status: string) {
  return status === UNTRACKED ? 'U' : status;
}
const statusClasses: Partial<Record<string, string>> = {
  A: addedInk,
  D: removedInk,
  C: 'text-deleted opacity-50 dark:text-deleted-dark',
  M: 'text-modified dark:text-modified-dark',
};
const otherStatusClass = 'text-untracked dark:text-untracked-dark';
export function statusClass(status: string) {
  return statusClasses[status] ?? otherStatusClass;
}
export function sourceFor(entry?: Entry): Source {
  if (!entry || entry.index === UNTRACKED) return 'file';
  if (entry.worktree !== UNMODIFIED) return 'unstaged';
  if (entry.index !== UNMODIFIED) return 'staged';
  return 'file';
}
export type Section = Group | 'conflicts';
export function inSection(entry: Entry, section: Section) {
  if (section === 'conflicts') return entry.kind === 'unmerged';
  if (entry.kind === 'unmerged') return false;
  return section === 'staged'
    ? entry.index !== UNMODIFIED && entry.index !== UNTRACKED
    : entry.worktree !== UNMODIFIED;
}
export function groupEntries(status: Status, group: Section, filter: string) {
  const needle = filter.toLowerCase();
  return status.entries.filter(
    (entry) =>
      entry.path.toLowerCase().includes(needle) && inSection(entry, group),
  );
}
export interface Node extends TreeEntry {
  children: string[];
  paths: string[];
  partial: boolean;
}
export function changeNodes(entries: Entry[], source: Section, filter: string) {
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
  const needle = filter.toLowerCase();
  const selected = entries
    .filter((entry) => inSection(entry, source))
    .filter((entry) => entry.path.toLowerCase().includes(needle));
  for (const entry of selected) addEntry(map, entry, source);
  compactChains(map, treeRoot);
  return map;
}
function sideStatus(entry: Entry, source: Section) {
  return source === 'staged' ? entry.index : entry.worktree;
}
function stagedAndUnstaged(entry: Entry) {
  const indexed = entry.index !== UNMODIFIED && entry.index !== UNTRACKED;
  return indexed && entry.worktree !== UNMODIFIED;
}
function isPartial(entry: Entry, source: Section) {
  return source !== 'conflicts' && stagedAndUnstaged(entry);
}
interface NodeSpot {
  path: string;
  name: string;
  leaf: boolean;
}
function newNode(spot: NodeSpot, status: string): Node {
  return {
    path: spot.path,
    name: spot.name,
    directory: !spot.leaf,
    ignored: false,
    status: status,
    children: [],
    paths: [],
    partial: false,
  };
}
function addEntry(map: Record<string, Node>, entry: Entry, source: Section) {
  const parts = entry.path.split('/');
  let parent = treeRoot;
  parts.forEach((part, index) => {
    const path = parts.slice(0, index + 1).join('/');
    const leaf = index === parts.length - 1;
    if (!map[path]) {
      const status = leaf ? sideStatus(entry, source) : '';
      map[path] = newNode({ path: path, name: part, leaf: leaf }, status);
      map[parent].children.push(path);
    }
    map[path].paths.push(entry.path);
    map[path].partial ||= isPartial(entry, source);
    parent = path;
  });
}

function compactChains(map: Record<string, Node>, id: string) {
  const node = map[id];
  if (!node) return;
  if (id !== treeRoot) {
    let only = node.children.length === 1 ? map[node.children[0]] : undefined;
    while (only?.directory) {
      delete map[only.path];
      node.name = `${node.name}/${only.name}`;
      node.path = only.path;
      node.children = only.children;
      only = node.children.length === 1 ? map[node.children[0]] : undefined;
    }
  }
  for (const child of node.children) compactChains(map, child);
}

export function treeOrder(paths: string[]) {
  const map = changeNodes(
    paths.map((path) => ({
      kind: 'ordinary' as const,
      path: path,
      index: 'M',
      worktree: UNMODIFIED,
    })),
    'staged',
    '',
  );
  const ordered: string[] = [];
  const walk = (id: string) => {
    const node = map[id];
    if (!node) return;
    if (id !== treeRoot && !node.directory) ordered.push(node.path);
    for (const child of node.children) walk(child);
  };
  walk(treeRoot);
  return ordered;
}

export function folderLines(
  nodes: Record<string, Node>,
  lines: Record<string, Lines> | undefined,
) {
  const sums: Record<string, Lines> = Object.create(null);
  if (!lines) return sums;
  const walk = (id: string): LineTotals => {
    const node = nodes[id];
    if (!node.directory) return lines[node.path] ?? [0, 0];
    let added = 0;
    let removed = 0;
    for (const child of node.children) {
      const [childAdded, childRemoved] = walk(child);
      added += childAdded;
      removed += childRemoved;
    }
    sums[id] = [added, removed];
    return [added, removed];
  };
  walk(treeRoot);
  return sums;
}

export function directoryIds(nodes: Record<string, Node>) {
  return Object.keys(nodes).filter((id) => nodes[id].directory);
}

export function useExpandNewDirectories(
  tree: TreeInstance<Node>,
  nodes: Record<string, Node>,
) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = directoryIds(nodes);
    const previous = seen.current;
    seen.current = new Set(ids);
    if (!previous) return;
    const fresh = ids
      .filter((id) => id !== treeRoot && !previous.has(id))
      .sort((left, right) => left.split('/').length - right.split('/').length);
    for (const id of fresh) tree.getItemInstance(id)?.expand();
  }, [tree, nodes]);
}
