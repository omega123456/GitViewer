import { useEffect, useMemo, useRef } from 'react';
import { useTree } from '@headless-tree/react';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
} from '@headless-tree/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FileIcon } from './FileIcon';
import { StatusBadge } from './StatusBadge';
import { LineCount } from '../shared/LineCount';
import type { Lines } from '../../lib/types';
import { useCompact } from '../../stores/density';
import { dynamic, focus, pill } from '../shared/styles';
import {
  changeNodes,
  directoryIds,
  folderLines,
  treeRoot,
  useExpandNewDirectories,
  type Node,
} from './nodes';
import { openNode, useRevealInTree } from './reveal';

export function RevisionTree({
  repo,
  tree: key,
  paths,
  statuses,
  lines,
  label,
  selectedPath,
  onSelect,
}: {
  repo: string;
  tree: string;
  paths: string[];
  statuses?: Record<string, string>;
  lines?: Record<string, Lines>;
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
          index: '.',
          worktree: statuses?.[path] ?? 'M',
        })),
        'unstaged',
        '',
      ),
    [paths, statuses],
  );
  const folders = useMemo(() => folderLines(nodes, lines), [nodes, lines]);
  const tree = useTree<Node>({
    rootItemId: treeRoot,
    initialState: {
      expandedItems: directoryIds(nodes),
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
  useExpandNewDirectories(tree, nodes);
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
  useRevealInTree({
    repo,
    tree: key,
    instance: tree,
    items,
    scroll: (index) => virtual.scrollToIndex(index, { align: 'center' }),
    open: openNode(tree, nodes),
  });
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
              className={`absolute top-0 right-1 left-1 flex translate-y-row items-center gap-1.5 rounded pr-2 pl-indent text-left text-sm hover:bg-hover dark:hover:bg-hover-dark ${compact ? 'h-tree-compact' : 'h-tree-comfortable'} ${selectedPath === node.path ? 'bg-selected dark:bg-selected-dark' : ''} ${focus}`}
              style={dynamic({
                '--row-offset': `${row.start}px`,
                '--tree-indent': `${item.getItemMeta().level * 16 + 6}px`,
              })}
            >
              {selectedPath === node.path && <span className={pill} />}
              {node.directory ? (
                item.isExpanded() ? (
                  <ChevronDown className="size-3 shrink-0 text-muted dark:text-muted-dark" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 text-muted dark:text-muted-dark" />
                )
              ) : (
                <span className="size-3 shrink-0" />
              )}
              <FileIcon
                name={node.name}
                directory={node.directory}
                expanded={item.isExpanded()}
              />
              <span className="truncate">{node.name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <LineCount
                  lines={
                    node.directory
                      ? item.isExpanded()
                        ? undefined
                        : folders[item.getId()]
                      : lines?.[node.path]
                  }
                  className={node.directory ? 'opacity-75' : ''}
                />
                {statuses && !node.directory && (
                  <StatusBadge status={node.status} />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
