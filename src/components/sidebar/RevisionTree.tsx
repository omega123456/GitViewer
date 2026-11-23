import { useEffect, useMemo } from 'react';
import { useTree } from '@headless-tree/react';
import type { ItemInstance } from '@headless-tree/core';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
} from '@headless-tree/core';
import { StatusBadge } from './StatusBadge';
import { LineCount } from '../shared/LineCount';
import type { Lines } from '../../lib/types';
import { useCompact } from '../../lib/theme';
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

const DEFAULT_STATUS = 'M';
interface RevisionTreeProps {
  repo: string;
  tree: string;
  paths: string[];
  statuses?: Record<string, string>;
  lines?: Record<string, Lines>;
  label: string;
  selectedPath?: string;
  onSelect: (path: string) => void;
}
function revisionNodes(paths: string[], statuses?: Record<string, string>) {
  return changeNodes(
    paths.map((path) => ({
      kind: 'ordinary',
      path: path,
      index: UNMODIFIED,
      worktree: statuses?.[path] ?? DEFAULT_STATUS,
    })),
    'unstaged',
    '',
  );
}
function useRevisionTree(
  nodes: Record<string, Node>,
  onSelect: (path: string) => void,
) {
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
  return tree;
}
interface RevisionView {
  props: RevisionTreeProps;
  compact: boolean;
  folders: Record<string, Lines>;
}
function RevisionRow({
  item,
  start,
  view,
}: {
  item: ItemInstance<Node>;
  start: number;
  view: RevisionView;
}) {
  const { selectedPath, statuses, lines, onSelect } = view.props;
  const node = item.getItemData();
  const expanded = item.isExpanded();
  const selected = selectedPath === node.path;
  const badged = statuses && !node.directory;
  return (
    <button
      {...item.getProps()}
      title={node.path}
      onClick={(event) => {
        item.getProps().onClick?.(event);
        if (!node.directory) onSelect(node.path);
      }}
      className={`${treeRowButton} ${treeRowHeightClass(view.compact)} ${selected ? selectedRow : ''} ${clickable} ${focus}`}
      style={treeRowPosition(start, item.getItemMeta().level)}
    >
      <TreeRowContent
        name={node.name}
        directory={node.directory}
        expanded={expanded}
        selected={selected}
      >
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <LineCount
            lines={rowLines({
              id: item.getId(),
              node: node,
              expanded: expanded,
              folders: view.folders,
              lines: lines,
            })}
            className={node.directory ? 'opacity-75' : ''}
          />
          {badged && <StatusBadge status={node.status} />}
        </span>
      </TreeRowContent>
    </button>
  );
}
export function RevisionTree(props: RevisionTreeProps) {
  const {
    repo,
    tree: key,
    paths,
    statuses,
    lines,
    label,
    selectedPath,
  } = props;
  const compact = useCompact();
  const nodes = useMemo(
    () => revisionNodes(paths, statuses),
    [paths, statuses],
  );
  const folders = useMemo(() => folderLines(nodes, lines), [nodes, lines]);
  const tree = useRevisionTree(nodes, props.onSelect);
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
  const view = { props: props, compact: compact, folders: folders };
  return (
    <div
      {...tree.getContainerProps()}
      ref={parent}
      aria-label={label}
      className="min-h-0 flex-1 overflow-auto"
    >
      <VirtualCanvas height={virtual.getTotalSize()}>
        {virtual.getVirtualItems().map((row) => (
          <RevisionRow
            key={items[row.index].getId()}
            item={items[row.index]}
            start={row.start}
            view={view}
          />
        ))}
      </VirtualCanvas>
    </div>
  );
}
