import { useEffect, useRef } from 'react';
import type { ItemInstance, TreeInstance } from '@headless-tree/core';
import type { Selection } from '../../lib/types';
import { fileName } from '../../stores/editor';
import { useFilterStore } from '../../stores/filter';
import { useLayout } from '../../stores/layout';
import {
  useReveal,
  useRevealTarget,
  type RevealTarget,
} from '../../stores/reveal';
import { useSelection } from '../../stores/selection';
import { treeRoot, type Node } from './nodes';
export function revisionTree({
  source,
  base,
  revision,
}: Pick<Selection, 'source' | 'base' | 'revision'>) {
  return `${source}:${base ?? ''}:${revision ?? ''}`;
}
export function revealInSidebar(repo: string, selection: Selection) {
  useSelection.getState().select(repo, selection);
  const working = ['staged', 'unstaged', 'file'].includes(selection.source);
  const tree = working ? 'files' : revisionTree(selection);
  if (working) {
    useLayout.getState().update(repo, { filesOpen: true });
    const filter = useFilterStore.getState().text[repo]?.toLowerCase();
    if (filter && !fileName(selection.path).toLowerCase().includes(filter))
      useFilterStore.getState().set(repo, '');
  }
  if (selection.source === 'stash')
    useLayout.getState().update(repo, { stashOpen: true });
  useReveal.getState().request(repo, { tree, path: selection.path });
}
function ancestors(path: string) {
  const parts = path.split('/');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'));
}
function expand<T>(tree: TreeInstance<T>, id: string) {
  const item = tree.getItemInstance(id);
  if (!item.isExpanded()) item.expand();
}
export function openNode(
  tree: TreeInstance<Node>,
  nodes: Record<string, Node>,
) {
  return async (path: string) => {
    if (!nodes[path]) return false;
    for (const folder of ancestors(path))
      if (nodes[folder]) expand(tree, folder);
    return true;
  };
}
export function openEntry<T>(tree: TreeInstance<T>) {
  return async (path: string) => {
    let parent = treeRoot;
    for (const id of [...ancestors(path), path]) {
      if (!(await tree.loadChildrenIds(parent)).includes(id)) return false;
      if (id !== path) expand(tree, id);
      parent = id;
    }
    return true;
  };
}
export function useRevealInTree<T>({
  repo,
  tree,
  instance,
  items,
  scroll,
  open,
}: {
  repo: string;
  tree: string;
  instance: TreeInstance<T>;
  items: ItemInstance<T>[];
  scroll: (index: number) => void;
  open: (path: string) => Promise<boolean>;
}) {
  const target = useRevealTarget(repo, tree);
  const opening = useRef<RevealTarget | undefined>(undefined);
  useEffect(() => {
    if (!target) return;
    const index = items.findIndex((item) => item.getId() === target.path);
    if (index >= 0) {
      scroll(index);
      items[index].setFocused();
      instance.updateDomFocus();
      useReveal.getState().finish(repo, target);
    } else if (opening.current !== target) {
      opening.current = target;
      void open(target.path).then((found) => {
        if (!found) useReveal.getState().finish(repo, target);
      });
    }
  }, [repo, target, items, instance, scroll, open]);
}
