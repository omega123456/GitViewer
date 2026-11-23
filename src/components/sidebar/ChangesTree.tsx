import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTree } from '@headless-tree/react';
import type { ItemInstance, TreeInstance } from '@headless-tree/core';
import {
  expandAllFeature,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import { perform } from '../../lib/query';
import { revertFiles } from '../../lib/revert';
import { useOpenFile } from '../../lib/open-file';
import { useCompact } from '../../lib/theme';
import { UNTRACKED } from '../../lib/git';
import type { Entry, Lines, Source, Status } from '../../lib/types';
import { useDeferredFilter } from '../../stores/filter';
import { useWorkingSelection } from '../../stores/selection';
import { Button } from '../shared/Button';
import { FileMenu } from '../shared/FileMenu';
import { LineCount } from '../shared/LineCount';
import { GroupHeader } from '../shared/Section';
import { VirtualCanvas } from '../shared/VirtualCanvas';
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
import { treeRowHeight } from './geometry';
import {
  changeNodes,
  directoryIds,
  folderLines,
  treeRoot,
  useExpandNewDirectories,
  type Node,
  type Section,
} from './nodes';
import { StatusBadge } from './StatusBadge';
import {
  rowLines,
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
interface StageWording {
  verb: string;
  action: 'stage' | 'unstage';
  className: string;
  icon: ReactNode;
}
const stageWording: Record<'staged' | 'other', StageWording> = {
  staged: {
    verb: 'Unstage',
    action: 'unstage',
    className: 'text-modified dark:text-modified-dark',
    icon: <Minus className="size-3" />,
  },
  other: {
    verb: 'Stage',
    action: 'stage',
    className: addedInk,
    icon: <Plus className="size-3" />,
  },
};
function stageWordingFor(source: Section) {
  return source === 'staged' ? stageWording.staged : stageWording.other;
}
function discardLabel(node: Node) {
  return node.directory
    ? `Discard all in ${node.path}`
    : `Discard ${node.path}`;
}
function discardPaths(node: Node, entries: Entry[]) {
  if (!node.directory) return [node.path];
  const prefix = `${node.path}/`;
  return entries
    .filter((entry) => entry.path.startsWith(prefix))
    .map((entry) => entry.path);
}
interface ChangesView {
  context: ChangesContext;
  group: ChangesGroup;
  lines?: Record<string, Lines>;
  folders: Record<string, Lines>;
  target: Source;
  compact: boolean;
  selection?: { path: string; source: Source };
  openNode: (node: Node) => void;
}
function RowActions({ node, view }: { node: Node; view: ChangesView }) {
  const { repo, status, disabled } = view.context;
  const wording = stageWordingFor(view.group.source);
  return (
    <div className={slot}>
      <Button
        variant="icon"
        className={`${iconButton} ${discardIcon}`}
        disabled={disabled}
        aria-label={discardLabel(node)}
        title={discardLabel(node)}
        onClick={() =>
          void revertFiles({
            repo: repo,
            paths: discardPaths(node, status.entries),
            all: false,
            folder: node.directory ? node.path : undefined,
          })
        }
      >
        <Trash2 className="size-3" />
      </Button>
      <Button
        variant="icon"
        className={`${iconButton} ${wording.className}`}
        disabled={disabled}
        aria-label={`${wording.verb} ${node.path}`}
        title={`${wording.verb} ${node.path}`}
        onClick={() =>
          void perform('files_action', {
            repo: repo,
            paths: node.paths,
            action: wording.action,
          })
        }
      >
        {wording.icon}
      </Button>
    </div>
  );
}
function isSelected(view: ChangesView, node: Node, source: Source | Section) {
  const selection = view.selection;
  return selection?.path === node.path && selection.source === source;
}
function RowContent({
  item,
  node,
  view,
}: {
  item: ItemInstance<Node>;
  node: Node;
  view: ChangesView;
}) {
  const expanded = item.isExpanded();
  const lines = rowLines({
    id: item.getId(),
    node: node,
    expanded: expanded,
    folders: view.folders,
    lines: view.lines,
  });
  return (
    <TreeRowContent
      name={node.name}
      directory={node.directory}
      expanded={expanded}
      selected={isSelected(view, node, view.target)}
    >
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <LineCount
          lines={lines}
          className={`group-focus-within:invisible group-hover:invisible ${node.directory ? 'opacity-75' : ''}`}
        />
        <StatusBadge
          status={node.status}
          partial={node.directory && node.partial}
        />
      </span>
    </TreeRowContent>
  );
}
function ChangeRow({
  item,
  start,
  view,
}: {
  item: ItemInstance<Node>;
  start: number;
  view: ChangesView;
}) {
  const node = item.getItemData();
  if (!node) return null;
  const selected = isSelected(view, node, view.group.source);
  return (
    <div
      className={`group absolute top-0 right-1 left-1 flex translate-y-row items-center rounded ${rowTint} ${selected ? selectedRow : ''}`}
      style={treeRowPosition(start, item.getItemMeta().level)}
    >
      <FileMenu
        repo={view.context.repo}
        path={node.path}
        disabled={node.directory}
      >
        <button
          {...item.getProps()}
          onClick={(event) => {
            item.getProps().onClick?.(event);
            if (!node.directory) view.openNode(node);
          }}
          className={`relative flex min-w-0 flex-1 items-center gap-1.5 pr-2 pl-indent text-left text-sm ${treeRowHeightClass(view.compact)} ${clickable} ${focus}`}
        >
          <RowContent item={item} node={node} view={view} />
        </button>
      </FileMenu>
      <RowActions node={node} view={view} />
    </div>
  );
}
function TreeFolds({
  title,
  tree,
}: {
  title: string;
  tree: TreeInstance<Node>;
}) {
  return (
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
  );
}
function hasDirectories(nodes: Record<string, Node>) {
  return Object.keys(nodes).some(
    (id) => id !== treeRoot && nodes[id].directory,
  );
}
function useChangeNodes(context: ChangesContext, source: Section) {
  const filter = useDeferredFilter(context.repo);
  const nodes = useMemo(
    () => changeNodes(context.status.entries, source, filter),
    [context.status.entries, source, filter],
  );
  return { filter: filter, nodes: nodes };
}
function useChangesTree(
  nodes: Record<string, Node>,
  openNode: (node: Node) => void,
) {
  const [expandedItems] = useState(() => directoryIds(nodes));
  return useTree<Node>({
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
}
function targetSource(source: Section): Source {
  return source === 'conflicts' ? 'unstaged' : source;
}
function useChangesView(
  context: ChangesContext,
  group: ChangesGroup,
  lines?: Record<string, Lines>,
) {
  const { repo, status } = context;
  const compact = useCompact();
  const selection = useWorkingSelection(repo);
  const openFile = useOpenFile(repo);
  const target = targetSource(group.source);
  const openNode = (node: Node) =>
    openFile({
      path: node.path,
      source: node.status === UNTRACKED ? 'file' : target,
    });
  const { filter, nodes } = useChangeNodes(context, group.source);
  const folders = useMemo(() => folderLines(nodes, lines), [nodes, lines]);
  const tree = useChangesTree(nodes, openNode);
  useEffect(() => {
    tree.rebuildTree();
  }, [tree, status, filter]);
  useExpandNewDirectories(tree, nodes);
  const hasDirectory = useMemo(() => hasDirectories(nodes), [nodes]);
  const view: ChangesView = {
    context: context,
    group: group,
    lines: lines,
    folders: folders,
    target: target,
    compact: compact,
    selection: selection,
    openNode: openNode,
  };
  return { tree: tree, view: view, hasDirectory: hasDirectory };
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
  const { tree, view, hasDirectory } = useChangesView(
    context,
    group,
    groupLines.files,
  );
  const items = tree.getItems();
  const { parent, virtual } = useTreeVirtualizer(
    items.length,
    treeRowHeight(view.compact),
  );
  return (
    <>
      <GroupHeader
        title={group.title}
        count={group.count}
        lines={groupLines.total}
        folds={hasDirectory && <TreeFolds title={group.title} tree={tree} />}
        actions={actions}
      />
      <div
        {...tree.getContainerProps()}
        ref={parent}
        aria-label={group.source === 'staged' ? 'Staged changes' : 'Changes'}
        className={`min-h-0 overflow-auto ${group.fill ? 'flex-1' : 'max-h-staged-cap'}`}
      >
        <VirtualCanvas height={virtual.getTotalSize()}>
          {virtual.getVirtualItems().map((row) => (
            <ChangeRow
              key={items[row.index].getId()}
              item={items[row.index]}
              start={row.start}
              view={view}
            />
          ))}
        </VirtualCanvas>
      </div>
    </>
  );
}
