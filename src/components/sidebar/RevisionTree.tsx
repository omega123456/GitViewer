import { useEffect, useMemo, useRef } from 'react';
import { useTree } from '@headless-tree/react';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
} from '@headless-tree/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { useCompact } from '../../stores/density';
import { dynamic, focus } from '../shared/styles';
import { changeNodes, treeRoot, type Node } from './nodes';

export function RevisionTree({
  paths,
  label,
  selectedPath,
  onSelect,
}: {
  paths: string[];
  label: string;
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const compact = useCompact();
  const nodes = useMemo(
    () =>
      changeNodes(
        paths.map((path) => ({
          kind: 'ordinary',
          path,
          index: 'M',
          worktree: '.',
        })),
        'staged',
        '',
      ),
    [paths],
  );
  const tree = useTree<Node>({
    rootItemId: treeRoot,
    initialState: {
      expandedItems: Object.keys(nodes).filter((id) => nodes[id].directory),
    },
    getItemName: (item) => item.getItemData()?.name ?? '',
    isItemFolder: (item) => item.getItemData()?.directory ?? false,
    dataLoader: {
      getItem: (id) => nodes[id] ?? nodes[treeRoot],
      getChildren: (id) => nodes[id]?.children ?? [],
    },
    onPrimaryAction: (item) => {
      const node = item.getItemData();
      if (!node.directory) onSelect(node.path);
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });
  useEffect(() => {
    tree.rebuildTree();
  }, [tree, nodes]);
  const parent = useRef<HTMLDivElement>(null);
  const items = tree.getItems();
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => (compact ? 22 : 26),
    overscan: 8,
  });
  const selectedIndex = items.findIndex(
    (item) => item.getItemData().path === selectedPath,
  );
  useEffect(() => {
    if (selectedIndex >= 0) virtual.scrollToIndex(selectedIndex);
  }, [virtual, selectedIndex]);
  return (
    <div
      {...tree.getContainerProps()}
      ref={parent}
      aria-label={label}
      className="min-h-0 flex-1 overflow-auto"
    >
      <div
        className="relative h-virtual"
        style={dynamic({ '--virtual-height': `${virtual.getTotalSize()}px` })}
      >
        {virtual.getVirtualItems().map((row) => {
          const item = items[row.index];
          const node = item.getItemData();
          return (
            <button
              {...item.getProps()}
              key={item.getId()}
              title={node.path}
              onClick={(event) => {
                item.getProps().onClick?.(event);
                if (!node.directory) onSelect(node.path);
              }}
              className={`absolute top-0 left-0 flex w-full translate-y-row items-center gap-1.5 pr-2 pl-indent text-left text-sm hover:bg-hover dark:hover:bg-hover-dark ${compact ? 'h-tree-compact' : 'h-tree-comfortable'} ${selectedPath === node.path ? 'bg-selected dark:bg-selected-dark' : ''} ${focus}`}
              style={dynamic({
                '--row-offset': `${row.start}px`,
                '--tree-indent': `${item.getItemMeta().level * 14 + 8}px`,
              })}
            >
              {node.directory ? (
                item.isExpanded() ? (
                  <ChevronDown className="size-3 shrink-0" />
                ) : (
                  <ChevronRight className="size-3 shrink-0" />
                )
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {node.directory ? (
                <Folder className="size-3 shrink-0" />
              ) : (
                <File className="size-3 shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
