import { revertFiles } from '../../lib/revert';
import { Button } from '../shared/Button';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTree } from '@headless-tree/react';
import {
  asyncDataLoaderFeature,
  expandAllFeature,
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
} from '@headless-tree/core';
import {
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { client, perform, queryKey } from '../../lib/query';
import { invoke, normalizeError } from '../../lib/ipc';
import { useErrors } from '../../stores/errors';
import { useSelection, useWorkingSelection } from '../../stores/selection';
import { useFilter } from '../../stores/filter';
import { useCompact } from '../../stores/density';
import type { Source, Status, TreeEntry } from '../../lib/types';
import { dynamic, focus, revealSlot, rowTint } from '../shared/styles';
import { FileMenu } from '../shared/FileMenu';
import { GroupHeader } from '../shared/Section';
import { State } from '../states/State';
import { FileIcon } from './FileIcon';
import { StatusBadge } from './StatusBadge';
import {
  changeNodes,
  directoryIds,
  sourceFor,
  treeRoot,
  useExpandNewDirectories,
  type Node,
  type Section,
} from './nodes';
const rowAction = 'size-6';
const discardTint =
  'text-muted hover:text-deleted dark:text-muted-dark dark:hover:text-deleted-dark';
const slot = `${revealSlot} right-badge-slot`;
const foldTint =
  'text-muted hover:text-ink dark:text-muted-dark dark:hover:text-ink-dark';
export function ChangesTree({
  repo,
  status,
  source,
  disabled,
  fill,
  title,
  count,
  actions,
}: {
  repo: string;
  status: Status;
  source: Section;
  disabled: boolean;
  fill: boolean;
  title: string;
  count: number;
  actions: ReactNode;
}) {
  const filter = useFilter(repo);
  const compact = useCompact();
  const selection = useWorkingSelection(repo);
  const target: Source = source === 'conflicts' ? 'unstaged' : source;
  const nodes = useMemo(
    () => changeNodes(status.entries, source, filter),
    [status.entries, source, filter],
  );
  const tree = useTree<Node>({
    rootItemId: treeRoot,
    initialState: {
      expandedItems: directoryIds(nodes),
    },
    getItemName: (item) => item.getItemData()?.name ?? '',
    isItemFolder: (item) => item.getItemData()?.directory ?? false,
    dataLoader: {
      getItem: (id) => nodes[id] ?? { ...nodes[treeRoot], directory: false },
      getChildren: (id) => nodes[id]?.children ?? [],
    },
    onPrimaryAction: (item) => {
      const node = item.getItemData();
      if (node && !node.directory)
        useSelection.getState().select(repo, {
          path: node.path,
          source: node.status === '?' ? 'file' : target,
        });
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
  const parent = useRef<HTMLDivElement>(null);
  const items = tree.getItems();
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => (compact ? 24 : 28),
    overscan: 8,
  });
  const hasDirectory = Object.keys(nodes).some(
    (id) => id !== treeRoot && nodes[id].directory,
  );
  return (
    <>
      <GroupHeader
        title={title}
        count={count}
        actions={
          <>
            {hasDirectory && (
              <>
                <Button
                  variant="icon"
                  className={`${rowAction} ${foldTint}`}
                  aria-label={`Expand all ${title}`}
                  title={`Expand all ${title}`}
                  onClick={() => void tree.expandAll()}
                >
                  <ChevronsUpDown className="size-4" />
                </Button>
                <Button
                  variant="icon"
                  className={`${rowAction} ${foldTint}`}
                  aria-label={`Collapse all ${title}`}
                  title={`Collapse all ${title}`}
                  onClick={() => tree.collapseAll()}
                >
                  <ChevronsDownUp className="size-4" />
                </Button>
              </>
            )}
            {actions}
          </>
        }
      />
      <div
        {...tree.getContainerProps()}
        ref={parent}
        aria-label={source === 'staged' ? 'Staged changes' : 'Changes'}
        className={`min-h-0 overflow-auto ${fill ? 'flex-1' : 'max-h-staged-cap'}`}
      >
        <div
          className="relative h-virtual"
          style={dynamic({ '--virtual-height': `${virtual.getTotalSize()}px` })}
        >
          {virtual.getVirtualItems().map((row) => {
            const item = items[row.index];
            const node = item.getItemData();
            if (!node) return null;
            return (
              <div
                key={item.getId()}
                className={`group absolute top-0 left-0 flex w-full translate-y-row items-center ${rowTint} ${selection?.path === node.path && selection.source === source ? 'bg-selected dark:bg-selected-dark' : ''}`}
                style={dynamic({
                  '--row-offset': `${row.start}px`,
                  '--tree-indent': `${item.getItemMeta().level * 14 + 8}px`,
                })}
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
                      if (!node.directory)
                        useSelection.getState().select(repo, {
                          path: node.path,
                          source: node.status === '?' ? 'file' : target,
                        });
                    }}
                    className={`relative flex min-w-0 flex-1 items-center gap-1.5 pr-2 pl-indent text-left text-sm ${compact ? 'h-tree-compact' : 'h-tree-comfortable'} ${focus}`}
                  >
                    {selection?.path === node.path &&
                      selection.source === target && (
                        <span className="absolute inset-y-0 left-0 w-accent bg-accent" />
                      )}
                    {node.directory ? (
                      item.isExpanded() ? (
                        <ChevronDown className="size-3 shrink-0 text-muted dark:text-muted-dark" />
                      ) : (
                        <ChevronRight className="size-3 shrink-0 text-muted dark:text-muted-dark" />
                      )
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <FileIcon
                      name={node.name}
                      directory={node.directory}
                      expanded={item.isExpanded()}
                    />
                    <span className="truncate">{node.name}</span>
                    <StatusBadge
                      status={node.status}
                      partial={node.directory && node.partial}
                    />
                  </button>
                </FileMenu>
                <div className={slot}>
                  <Button
                    variant="icon"
                    className={`${rowAction} ${discardTint}`}
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
                      void revertFiles(
                        repo,
                        node.directory
                          ? status.entries
                              .filter((entry) =>
                                entry.path.startsWith(`${node.path}/`),
                              )
                              .map((entry) => entry.path)
                          : [node.path],
                        false,
                        node.directory ? node.path : undefined,
                      )
                    }
                  >
                    <Trash2 className="size-3" />
                  </Button>
                  <Button
                    variant="icon"
                    className={`${rowAction} ${source === 'staged' ? 'text-modified dark:text-modified-dark' : 'text-added dark:text-added-dark'}`}
                    disabled={disabled}
                    aria-label={`${source === 'staged' ? 'Unstage' : 'Stage'} ${node.path}`}
                    title={`${source === 'staged' ? 'Unstage' : 'Stage'} ${node.path}`}
                    onClick={() =>
                      void perform('files_action', {
                        repo,
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
        </div>
      </div>
    </>
  );
}
export function FilesTree({ repo, status }: { repo: string; status: Status }) {
  const filter = useFilter(repo);
  const compact = useCompact();
  const selection = useWorkingSelection(repo);
  const cache = useRef(new Map<string, TreeEntry>());
  const load = async (path: string) => {
    const args = { repo, path: path === treeRoot ? '' : path };
    const entries = await client.fetchQuery({
      queryKey: queryKey('tree', args),
      queryFn: () => invoke('tree', args),
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
      if (node && !node.directory)
        useSelection.getState().select(repo, {
          path: node.path,
          source: sourceFor(
            status.entries.find((entry) => entry.path === node.path),
          ),
        });
    },
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });
  useEffect(() => {
    const visible = [
      tree.getItemInstance(treeRoot),
      ...tree.getItems().filter((item) => item.isFolder() && item.isExpanded()),
    ];
    for (const item of visible) void item.invalidateChildrenIds(true);
  }, [tree, status]);
  const items = tree
    .getItems()
    .filter(
      (item) =>
        !filter ||
        item.getItemName().toLowerCase().includes(filter.toLowerCase()) ||
        item.isFolder(),
    );
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => (compact ? 24 : 28),
    overscan: 8,
  });
  return (
    <div
      {...tree.getContainerProps()}
      ref={parent}
      aria-label="All files"
      className="min-h-0 flex-1 overflow-auto"
    >
      <div
        className="relative h-virtual"
        style={dynamic({ '--virtual-height': `${virtual.getTotalSize()}px` })}
      >
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
                  if (!node.directory)
                    useSelection.getState().select(repo, {
                      path: node.path,
                      source: sourceFor(
                        status.entries.find(
                          (entry) => entry.path === node.path,
                        ),
                      ),
                    });
                }}
                className={`absolute top-0 left-0 flex w-full translate-y-row items-center gap-1.5 pr-2 pl-indent text-left text-sm hover:bg-hover dark:hover:bg-hover-dark ${compact ? 'h-tree-compact' : 'h-tree-comfortable'} ${node.ignored ? 'opacity-55' : ''} ${selection?.path === node.path ? 'bg-selected dark:bg-selected-dark' : ''} ${focus}`}
                style={dynamic({
                  '--row-offset': `${row.start}px`,
                  '--tree-indent': `${item.getItemMeta().level * 14 + 8}px`,
                })}
              >
                {selection?.path === node.path && (
                  <span className="absolute inset-y-0 left-0 w-accent bg-accent" />
                )}
                {node.directory ? (
                  item.isExpanded() ? (
                    <ChevronDown className="size-3 shrink-0 text-muted dark:text-muted-dark" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0 text-muted dark:text-muted-dark" />
                  )
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <FileIcon
                  name={node.name}
                  directory={node.directory}
                  expanded={item.isExpanded()}
                />
                <span className="truncate">{node.name}</span>
                <StatusBadge status={node.ignored ? '' : node.status} />
              </button>
            </FileMenu>
          );
        })}
      </div>
      {items.length === 0 && <State title="No files" />}
    </div>
  );
}
