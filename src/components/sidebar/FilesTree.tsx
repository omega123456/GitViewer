import { useEffect, useRef } from 'react';
import { useTree } from '@headless-tree/react';
import type { ItemInstance, TreeInstance } from '@headless-tree/core';
import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
} from '@headless-tree/core';
import { client, queryKey } from '../../lib/query';
import { invoke, normalizeError } from '../../lib/ipc';
import { useOpenFile } from '../../lib/open-file';
import { watchTreeInvalidation } from '../../lib/tree-refresh';
import { useCompact } from '../../lib/theme';
import type { Status, TreeEntry } from '../../lib/types';
import { useErrors } from '../../stores/errors';
import { useDeferredFilter } from '../../stores/filter';
import { useWorkingSelection } from '../../stores/selection';
import { FileMenu } from '../shared/FileMenu';
import { VirtualCanvas } from '../shared/VirtualCanvas';
import { clickable, focus, selectedRow } from '../shared/styles';
import { State } from '../states/State';
import { treeRowHeight } from './geometry';
import { sourceFor, treeRoot } from './nodes';
import { openEntry, useRevealInTree } from './reveal';
import { StatusBadge } from './StatusBadge';
import {
  treeRowButton,
  treeRowHeightClass,
  treeRowPosition,
  TreeRowContent,
  useTreeVirtualizer,
} from './TreeRow';

const LOADING_NAME = 'Loading…';
const loadingEntry: TreeEntry = {
  name: LOADING_NAME,
  path: '',
  directory: false,
  ignored: false,
  status: '',
};
const unknownEntry: TreeEntry = {
  name: '',
  path: '',
  directory: true,
  ignored: false,
  status: '',
};
function relistVisible(tree: TreeInstance<TreeEntry>) {
  const expandedFolders = tree
    .getItems()
    .filter((item) => item.isFolder() && item.isExpanded());
  const visible = [tree.getItemInstance(treeRoot), ...expandedFolders];
  for (const item of visible) void item.invalidateChildrenIds(true);
}
function matchesFilter(item: ItemInstance<TreeEntry>, filter: string) {
  const named = item.getItemName().toLowerCase().includes(filter.toLowerCase());
  return !filter || named || item.isFolder();
}
interface TreeLoader {
  repo: string;
  cache: Map<string, TreeEntry>;
  tree: () => TreeInstance<TreeEntry>;
}
async function loadChildren(loader: TreeLoader, path: string) {
  const args = { repo: loader.repo, path: path === treeRoot ? '' : path };
  const entries = await client.fetchQuery({
    queryKey: queryKey('tree', args),
    queryFn: () => invoke('tree', args),
    gcTime: Infinity,
  });
  entries.forEach((entry) => {
    loader.cache.set(entry.path, entry);
    loader.tree().getItemInstance(entry.path).updateCachedData(entry, true);
  });
  return entries.map((entry) => entry.path);
}
async function childrenOrNone(loader: TreeLoader, path: string) {
  try {
    return await loadChildren(loader, path);
  } catch (error) {
    useErrors
      .getState()
      .report(loader.repo, normalizeError(error), { command: 'tree' });
    return [];
  }
}
function useFilesTree(repo: string, openEntryFile: (node: TreeEntry) => void) {
  const cache = useRef(new Map<string, TreeEntry>());
  const loader: TreeLoader = {
    repo: repo,
    cache: cache.current,
    tree: () => tree,
  };
  const tree = useTree<TreeEntry>({
    rootItemId: treeRoot,
    getItemName: (item) => item.getItemData()?.name ?? LOADING_NAME,
    isItemFolder: (item) => item.getItemData()?.directory ?? false,
    createLoadingItemData: () => loadingEntry,
    dataLoader: {
      getItem: (id) => cache.current.get(id) ?? unknownEntry,
      getChildren: (id) => childrenOrNone(loader, id),
    },
    onPrimaryAction: (item) => {
      const node = item.getItemData();
      if (node && !node.directory) openEntryFile(node);
    },
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });
  useEffect(
    () => watchTreeInvalidation(repo, () => relistVisible(tree)),
    [tree, repo],
  );
  return tree;
}
interface FilesView {
  repo: string;
  compact: boolean;
  selected?: string;
  openEntryFile: (node: TreeEntry) => void;
}
function FileRow({
  item,
  start,
  view,
}: {
  item: ItemInstance<TreeEntry>;
  start: number;
  view: FilesView;
}) {
  const node = item.getItemData();
  if (!node) return null;
  const selected = view.selected === node.path;
  return (
    <FileMenu repo={view.repo} path={node.path} disabled={node.directory}>
      <button
        {...item.getProps()}
        onClick={(event) => {
          item.getProps().onClick?.(event);
          if (!node.directory) view.openEntryFile(node);
        }}
        className={`${treeRowButton} ${treeRowHeightClass(view.compact)} ${node.ignored ? 'opacity-55' : ''} ${selected ? selectedRow : ''} ${clickable} ${focus}`}
        style={treeRowPosition(start, item.getItemMeta().level)}
      >
        <TreeRowContent
          name={node.name}
          directory={node.directory}
          expanded={item.isExpanded()}
          selected={selected}
        >
          <StatusBadge status={node.ignored ? '' : node.status} />
        </TreeRowContent>
      </button>
    </FileMenu>
  );
}
function useFilesView(repo: string, status: Status): FilesView {
  const compact = useCompact();
  const selection = useWorkingSelection(repo);
  const openFile = useOpenFile(repo);
  const openEntryFile = (node: TreeEntry) =>
    openFile({
      path: node.path,
      source: sourceFor(
        status.entries.find((entry) => entry.path === node.path),
      ),
    });
  return {
    repo: repo,
    compact: compact,
    selected: selection?.path,
    openEntryFile: openEntryFile,
  };
}
export function FilesTree({ repo, status }: { repo: string; status: Status }) {
  const filter = useDeferredFilter(repo);
  const view = useFilesView(repo, status);
  const tree = useFilesTree(repo, view.openEntryFile);
  const items = tree.getItems().filter((item) => matchesFilter(item, filter));
  const { parent, virtual } = useTreeVirtualizer(
    items.length,
    treeRowHeight(view.compact),
  );
  useRevealInTree({
    repo: repo,
    tree: 'files',
    instance: tree,
    items: items,
    scroll: (index) => virtual.scrollToIndex(index, { align: 'center' }),
    open: openEntry(tree),
  });
  return (
    <div
      {...tree.getContainerProps()}
      ref={parent}
      aria-label="All files"
      className="min-h-0 flex-1 overflow-auto"
    >
      <VirtualCanvas height={virtual.getTotalSize()}>
        {virtual.getVirtualItems().map((row) => (
          <FileRow
            key={items[row.index].getId()}
            item={items[row.index]}
            start={row.start}
            view={view}
          />
        ))}
      </VirtualCanvas>
      {items.length === 0 && <State title="No files" />}
    </div>
  );
}
