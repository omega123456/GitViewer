import { revertFiles } from '../../lib/revert';
import { Button } from '../shared/Button';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTree } from '@headless-tree/react';
import type { TreeInstance } from '@headless-tree/core';
import {
  asyncDataLoaderFeature,
  expandAllFeature,
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
} from '@headless-tree/core';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import { client, perform, queryKey } from '../../lib/query';
import { invoke, normalizeError } from '../../lib/ipc';
import { useErrors } from '../../stores/errors';
import { useWorkingSelection } from '../../stores/selection';
import { useOpenFile } from '../../lib/open-file';
import { watchTreeInvalidation } from '../../lib/tree-refresh';
import { useDeferredFilter } from '../../stores/filter';
import { useCompact } from '../../lib/theme';
import type { Lines, Source, Status, TreeEntry } from '../../lib/types';
import { LineCount } from '../shared/LineCount';
import {
  addedInk,
  clickable,
  discardIcon,
  focus,
  iconButton,
  quietIcon,
  revealSlot,
  rowTint,
  selectedRow,
} from '../shared/styles';
import { VirtualCanvas } from '../shared/VirtualCanvas';
import { FileMenu } from '../shared/FileMenu';
import { GroupHeader } from '../shared/Section';
import { State } from '../states/State';
import { StatusBadge } from './StatusBadge';
import {
  changeNodes,
  directoryIds,
  folderLines,
  sourceFor,
  treeRoot,
  useExpandNewDirectories,
  type Node,
  type Section,
} from './nodes';
import { openEntry, useRevealInTree } from './reveal';
import { UNTRACKED } from '../../lib/git';
import { treeRowHeight } from './geometry';
import {
  rowLines,
  treeRowButton,
  treeRowHeightClass,
  treeRowPosition,
  TreeRowContent,
  useTreeVirtualizer,
} from './TreeRow';
const slot = `${revealSlot} right-badge-slot`;
export interface ChangesContext {
  repo: string;
  status: Status;
  disabled: boolean;
}
export interface ChangesGroup {
  source: Section;
  title: string;
  count: number;
  fill: boolean;
}
export interface GroupLines {
  files?: Record<string, Lines>;
  total?: Lines;
}
function relistVisible(tree: TreeInstance<TreeEntry>) {
  const expandedFolders = tree
    .getItems()
    .filter((item) => item.isFolder() && item.isExpanded());
  const visible = [tree.getItemInstance(treeRoot), ...expandedFolders];
  for (const item of visible) void item.invalidateChildrenIds(true);
}
export function ChangesTree({
  context,
  group,
  lines: groupLines,
  actions,
}: {
  context: ChangesContext;
  group: ChangesGroup;
  lines: GroupLines;
  actions: ReactNode;
}) {
  const { repo, status, disabled } = context;
  const { source, title, count, fill } = group;
  const { files: lines, total } = groupLines;
  const filter = useDeferredFilter(repo);
  const compact = useCompact();
  const selection = useWorkingSelection(repo);
  const openFile = useOpenFile(repo);
  const target: Source = source === 'conflicts' ? 'unstaged' : source;
  const openNode = (node: Node) =>
    openFile({
      path: node.path,
      source: node.status === UNTRACKED ? 'file' : target,
    });
  const nodes = useMemo(
    () => changeNodes(status.entries, source, filter),
    [status.entries, source, filter],
  );
  const folders = useMemo(() => folderLines(nodes, lines), [nodes, lines]);
  const [expandedItems] = useState(() => directoryIds(nodes));
  const tree = useTree<Node>({
    rootItemId: treeRoot,
    initialState: { expandedItems },
    getItemName: (item) => item.getItemData()?.name ?? '',
    isItemFolder: (item) => item.getItemData()?.directory ?? false,
    dataLoader: {
      getItem: (id) => nodes[id] ?? { ...nodes[treeRoot], directory: false },
      getChildren: (id) => nodes[id]?.children ?? [],
    },
    onPrimaryAction: (item) => {
      const node = item.getItemData();
      if (node && !node.directory) openNode(node);
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      expandAllFeature,
    ],
  });
  useEffect(() => {
    tree.rebuildTree();
  }, [tree, status, filter]);
  useExpandNewDirectories(tree, nodes);
  const items = tree.getItems();
  const { parent, virtual } = useTreeVirtualizer(
    items.length,
    treeRowHeight(compact),
  );
  const hasDirectory = useMemo(
    () =>
      Object.keys(nodes).some((id) => id !== treeRoot && nodes[id].directory),
    [nodes],
  );
  return (
    <>
      <GroupHeader
        title={title}
        count={count}
        lines={total}
        folds={
          hasDirectory && (
            <>
              <Button
                variant="icon"
                className={`${iconButton} ${quietIcon}`}
                aria-label={`Expand all ${title}`}
                title={`Expand all ${title}`}
                onClick={() => void tree.expandAll()}
              >
                <ChevronsUpDown className="size-4" />
              </Button>
              <Button
                variant="icon"
                className={`${iconButton} ${quietIcon}`}
                aria-label={`Collapse all ${title}`}
                title={`Collapse all ${title}`}
                onClick={() => tree.collapseAll()}
              >
                <ChevronsDownUp className="size-4" />
              </Button>
            </>
          )
        }
        actions={actions}
      />
      <div
        {...tree.getContainerProps()}
        ref={parent}
        aria-label={source === 'staged' ? 'Staged changes' : 'Changes'}
        className={`min-h-0 overflow-auto ${fill ? 'flex-1' : 'max-h-staged-cap'}`}
      >
        <VirtualCanvas height={virtual.getTotalSize()}>
          {virtual.getVirtualItems().map((row) => {
            const item = items[row.index];
            const node = item.getItemData();
            if (!node) return null;
            const expanded = item.isExpanded();
            return (
              <div
                key={item.getId()}
                className={`group absolute top-0 right-1 left-1 flex translate-y-row items-center rounded ${rowTint} ${selection?.path === node.path && selection.source === source ? selectedRow : ''}`}
                style={treeRowPosition(row.start, item.getItemMeta().level)}
              >
                <FileMenu
                  repo={repo}
                  path={node.path}
                  disabled={node.directory}
                >
                  <button
                    {...item.getProps()}
                    onClick={(event) => {
                      item.getProps().onClick?.(event);
                      if (!node.directory) openNode(node);
                    }}
                    className={`relative flex min-w-0 flex-1 items-center gap-1.5 pr-2 pl-indent text-left text-sm ${treeRowHeightClass(compact)} ${clickable} ${focus}`}
                  >
                    <TreeRowContent
                      name={node.name}
                      directory={node.directory}
                      expanded={expanded}
                      selected={
                        selection?.path === node.path &&
                        selection.source === target
                      }
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
                          className={`group-focus-within:invisible group-hover:invisible ${node.directory ? 'opacity-75' : ''}`}
                        />
                        <StatusBadge
                          status={node.status}
                          partial={node.directory && node.partial}
                        />
                      </span>
                    </TreeRowContent>
                  </button>
                </FileMenu>
                <div className={slot}>
                  <Button
                    variant="icon"
                    className={`${iconButton} ${discardIcon}`}
                    disabled={disabled}
                    aria-label={
                      node.directory
                        ? `Discard all in ${node.path}`
                        : `Discard ${node.path}`
                    }
                    title={
                      node.directory
                        ? `Discard all in ${node.path}`
                        : `Discard ${node.path}`
                    }
                    onClick={() =>
                      void revertFiles({
                        repo: repo,
                        paths: node.directory
                          ? status.entries
                              .filter((entry) =>
                                entry.path.startsWith(`${node.path}/`),
                              )
                              .map((entry) => entry.path)
                          : [node.path],
                        all: false,
                        folder: node.directory ? node.path : undefined,
                      })
                    }
                  >
                    <Trash2 className="size-3" />
                  </Button>
                  <Button
                    variant="icon"
                    className={`${iconButton} ${source === 'staged' ? 'text-modified dark:text-modified-dark' : addedInk}`}
                    disabled={disabled}
                    aria-label={`${source === 'staged' ? 'Unstage' : 'Stage'} ${node.path}`}
                    title={`${source === 'staged' ? 'Unstage' : 'Stage'} ${node.path}`}
                    onClick={() =>
                      void perform('files_action', {
                        repo: repo,
                        paths: node.paths,
                        action: source === 'staged' ? 'unstage' : 'stage',
                      })
                    }
                  >
                    {source === 'staged' ? (
                      <Minus className="size-3" />
                    ) : (
                      <Plus className="size-3" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </VirtualCanvas>
      </div>
    </>
  );
}
export function FilesTree({ repo, status }: { repo: string; status: Status }) {
  const filter = useDeferredFilter(repo);
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
  const cache = useRef(new Map<string, TreeEntry>());
  const load = async (path: string) => {
    const args = { repo: repo, path: path === treeRoot ? '' : path };
    const entries = await client.fetchQuery({
      queryKey: queryKey('tree', args),
      queryFn: () => invoke('tree', args),
      gcTime: Infinity,
    });
    entries.forEach((entry) => {
      cache.current.set(entry.path, entry);
      tree.getItemInstance(entry.path).updateCachedData(entry, true);
    });
    return entries.map((entry) => entry.path);
  };
  const tree = useTree<TreeEntry>({
    rootItemId: treeRoot,
    getItemName: (item) => item.getItemData()?.name ?? 'Loading…',
    isItemFolder: (item) => item.getItemData()?.directory ?? false,
    createLoadingItemData: () => ({
      name: 'Loading…',
      path: '',
      directory: false,
      ignored: false,
      status: '',
    }),
    dataLoader: {
      getItem: (id) =>
        cache.current.get(id) ?? {
          name: '',
          path: '',
          directory: true,
          ignored: false,
          status: '',
        },
      getChildren: async (id) => {
        try {
          return await load(id);
        } catch (error) {
          useErrors
            .getState()
            .report(repo, normalizeError(error), { command: 'tree' });
          return [];
        }
      },
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
  const items = tree
    .getItems()
    .filter(
      (item) =>
        !filter ||
        item.getItemName().toLowerCase().includes(filter.toLowerCase()) ||
        item.isFolder(),
    );
  const { parent, virtual } = useTreeVirtualizer(
    items.length,
    treeRowHeight(compact),
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
        {virtual.getVirtualItems().map((row) => {
          const item = items[row.index];
          const node = item.getItemData();
          if (!node) return null;
          return (
            <FileMenu
              key={item.getId()}
              repo={repo}
              path={node.path}
              disabled={node.directory}
            >
              <button
                {...item.getProps()}
                onClick={(event) => {
                  item.getProps().onClick?.(event);
                  if (!node.directory) openEntryFile(node);
                }}
                className={`${treeRowButton} ${treeRowHeightClass(compact)} ${node.ignored ? 'opacity-55' : ''} ${selection?.path === node.path ? selectedRow : ''} ${clickable} ${focus}`}
                style={treeRowPosition(row.start, item.getItemMeta().level)}
              >
                <TreeRowContent
                  name={node.name}
                  directory={node.directory}
                  expanded={item.isExpanded()}
                  selected={selection?.path === node.path}
                >
                  <StatusBadge status={node.ignored ? '' : node.status} />
                </TreeRowContent>
              </button>
            </FileMenu>
          );
        })}
      </VirtualCanvas>
      {items.length === 0 && <State title="No files" />}
    </div>
  );
}
