import { useEffect, useMemo } from 'react';
import { useTree } from '@headless-tree/react';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
} from '@headless-tree/core';
import { StatusBadge } from './StatusBadge';
import { LineCount } from '../shared/LineCount';
import type { Lines } from '../../lib/types';
import { useCompact } from '../../stores/density';
import { clickable, focus, selectedRow } from '../shared/styles';
import { VirtualCanvas } from '../shared/VirtualCanvas';
import {
  rowLines,
  treeRowButton,
  treeRowHeightClass,
  treeRowPosition,
  TreeRowContent,
  useTreeVirtualizer,
} from './TreeRow';
import {
  changeNodes,
  directoryIds,
  folderLines,
  treeRoot,
  useExpandNewDirectories,
  type Node,
} from './nodes';
import { openNode, useRevealInTree } from './reveal';
import { UNMODIFIED } from '../../lib/git';
import { revisionRowHeight } from './geometry';

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
          path: path,
          index: UNMODIFIED,
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
  const items = tree.getItems();
  const { parent, virtual } = useTreeVirtualizer(
    items.length,
    revisionRowHeight(compact),
  );
  const selectedIndex = items.findIndex(
    (item) => item.getItemData().path === selectedPath,
  );
  useEffect(() => {
    if (selectedIndex >= 0) virtual.scrollToIndex(selectedIndex);
  }, [virtual, selectedIndex]);
  useRevealInTree({
    repo: repo,
    tree: key,
    instance: tree,
    items: items,
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
      <VirtualCanvas height={virtual.getTotalSize()}>
        {virtual.getVirtualItems().map((row) => {
          const item = items[row.index];
          const node = item.getItemData();
          const expanded = item.isExpanded();
          return (
            <button
              {...item.getProps()}
              key={item.getId()}
              title={node.path}
              onClick={(event) => {
                item.getProps().onClick?.(event);
                if (!node.directory) onSelect(node.path);
              }}
              className={`${treeRowButton} ${treeRowHeightClass(compact)} ${selectedPath === node.path ? selectedRow : ''} ${clickable} ${focus}`}
              style={treeRowPosition(row.start, item.getItemMeta().level)}
            >
              <TreeRowContent
                name={node.name}
                directory={node.directory}
                expanded={expanded}
                selected={selectedPath === node.path}
              >
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <LineCount
                    lines={rowLines({
                      id: item.getId(),
                      node: node,
                      expanded: expanded,
                      folders: folders,
                      lines: lines,
                    })}
                    className={node.directory ? 'opacity-75' : ''}
                  />
                  {statuses && !node.directory && (
                    <StatusBadge status={node.status} />
                  )}
                </span>
              </TreeRowContent>
            </button>
          );
        })}
      </VirtualCanvas>
    </div>
  );
}
