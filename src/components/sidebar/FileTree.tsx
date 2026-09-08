import { revertFiles } from '../../lib/revert';
import { Button } from '../shared/Button';
import { useEffect, useMemo, useRef } from 'react';
import { useTree } from '@headless-tree/react';
import {
  asyncDataLoaderFeature,
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
} from '@headless-tree/core';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  RotateCcw,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { client, perform, queryKey } from '../../lib/query';
import { invoke, normalizeError } from '../../lib/ipc';
import { useTabs } from '../../stores/tabs';
import { useSelection, useWorkingSelection } from '../../stores/selection';
import { useFilter } from '../../stores/filter';
import { useCompact } from '../../stores/density';
import type { Status, TreeEntry } from '../../lib/types';
import { CheckBox } from '../shared/CheckBox';
import { dynamic, focus } from '../shared/styles';
import { State } from '../states/State';
import { StatusBadge } from './StatusBadge';
import { changeNodes, sourceFor, treeRoot, type Node } from './nodes';
export function ChangesTree({
  repo,
  status,
  source,
  disabled,
  fill,
}: {
  repo: string;
  status: Status;
  source: 'staged' | 'unstaged';
  disabled: boolean;
  fill: boolean;
}) {
  const filter = useFilter(repo);
  const compact = useCompact();
  const selection = useWorkingSelection(repo);
  const nodes = useMemo(
    () => changeNodes(status.entries, source, filter),
    [status.entries, source, filter],
  );
  const tree = useTree<Node>({
    rootItemId: treeRoot,
    initialState: {
      expandedItems: Object.keys(nodes).filter((id) => nodes[id].directory),
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
          source: node.status === '?' ? 'file' : source,
        });
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });
  useEffect(() => {
    tree.rebuildTree();
  }, [tree, status, filter]);
  const parent = useRef<HTMLDivElement>(null);
  const items = tree.getItems();
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
              className="group absolute top-0 left-0 flex w-full translate-y-row items-center gap-1 pl-indent"
              style={dynamic({
                '--row-offset': `${row.start}px`,
                '--tree-indent': `${item.getItemMeta().level * 14 + 8}px`,
              })}
            >
              <CheckBox
                disabled={disabled}
                label={`${source === 'staged' ? 'Unstage' : 'Stage'} ${node.path}`}
                checked={
                  node.directory && node.partial
                    ? 'indeterminate'
                    : source === 'staged'
                }
                onChange={() =>
                  void perform('files_action', {
                    repo,
                    paths: node.paths,
                    action: source === 'staged' ? 'unstage' : 'stage',
                  })
                }
              />
              <button
                {...item.getProps()}
                onClick={(event) => {
                  item.getProps().onClick?.(event);
                  if (!node.directory)
                    useSelection.getState().select(repo, {
                      path: node.path,
                      source: node.status === '?' ? 'file' : source,
                    });
                }}
                className={`relative flex min-w-0 flex-1 items-center gap-1.5 pr-2 text-left text-sm hover:bg-hover dark:hover:bg-hover-dark ${compact ? 'h-tree-compact' : 'h-tree-comfortable'} ${focus} ${selection?.path === node.path && selection.source === source ? 'bg-selected dark:bg-selected-dark' : ''}`}
              >
                {selection?.path === node.path &&
                  selection.source === source && (
                    <span className="absolute inset-y-0 left-0 w-accent bg-accent" />
                  )}
                {node.directory ? (
                  item.isExpanded() ? (
                    <ChevronDown className="size-3 text-faint dark:text-faint-dark" />
                  ) : (
                    <ChevronRight className="size-3 text-faint dark:text-faint-dark" />
                  )
                ) : (
                  <span className="w-3" />
                )}
                {node.directory ? (
                  <Folder className="size-3 text-faint dark:text-faint-dark" />
                ) : (
                  <File className="size-3 text-faint dark:text-faint-dark" />
                )}
                <span className="truncate">{node.name}</span>
                <StatusBadge status={node.status} />
              </button>
              <Button
                className="size-6 p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                disabled={disabled}
                aria-label={
                  node.directory
                    ? `Revert all in ${node.path}`
                    : `Revert ${node.path}`
                }
                title={
                  node.directory
                    ? `Revert all in ${node.path}`
                    : `Revert ${node.path}`
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
                <RotateCcw className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
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
          useTabs.getState().setError(normalizeError(error));
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
            <button
              {...item.getProps()}
              key={item.getId()}
              onClick={(event) => {
                item.getProps().onClick?.(event);
                if (!node.directory)
                  useSelection.getState().select(repo, {
                    path: node.path,
                    source: sourceFor(
                      status.entries.find((entry) => entry.path === node.path),
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
                  <ChevronDown className="size-3 text-faint dark:text-faint-dark" />
                ) : (
                  <ChevronRight className="size-3 text-faint dark:text-faint-dark" />
                )
              ) : (
                <span className="w-3" />
              )}
              {node.directory ? (
                <Folder className="size-3 text-faint dark:text-faint-dark" />
              ) : (
                <File className="size-3 text-faint dark:text-faint-dark" />
              )}
              <span className="truncate">{node.name}</span>
              <StatusBadge status={node.ignored ? '' : node.status} />
            </button>
          );
        })}
      </div>
      {items.length === 0 && <State title="No files" />}
    </div>
  );
}
