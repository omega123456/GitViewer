import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Lines } from '../../lib/types';
import { dynamic, pill, treeChevron } from '../shared/styles';
import { FileIcon } from './FileIcon';
import { TREE_OVERSCAN, treeIndent } from './geometry';
import type { Node } from './nodes';
export const treeRowButton =
  'absolute top-0 right-1 left-1 flex translate-y-row items-center gap-1.5 rounded pr-2 pl-indent text-left text-sm hover:bg-hover dark:hover:bg-hover-dark';
export function treeRowHeightClass(compact: boolean) {
  return compact ? 'h-tree-compact' : 'h-tree-comfortable';
}
export function treeRowPosition(start: number, level: number) {
  return dynamic({
    '--row-offset': `${start}px`,
    '--tree-indent': treeIndent(level),
  });
}
export interface RowLinesSource {
  id: string;
  node: Node;
  expanded: boolean;
  folders: Record<string, Lines>;
  lines?: Record<string, Lines>;
}
export function rowLines(source: RowLinesSource) {
  if (!source.node.directory) return source.lines?.[source.node.path];
  if (source.expanded) return undefined;
  return source.folders[source.id];
}
export function useTreeVirtualizer(count: number, rowHeight: number) {
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: count,
    getScrollElement: () => parent.current,
    estimateSize: () => rowHeight,
    overscan: TREE_OVERSCAN,
  });
  return { parent, virtual };
}
function TreeChevron({
  directory,
  expanded,
}: {
  directory: boolean;
  expanded: boolean;
}) {
  if (!directory) return <span className="size-3 shrink-0" />;
  if (expanded) return <ChevronDown className={treeChevron} />;
  return <ChevronRight className={treeChevron} />;
}
export function TreeRowContent({
  name,
  directory,
  expanded,
  selected,
  children,
}: {
  name: string;
  directory: boolean;
  expanded: boolean;
  selected: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      {selected && <span className={pill} />}
      <TreeChevron directory={directory} expanded={expanded} />
      <FileIcon name={name} directory={directory} expanded={expanded} />
      <span className="truncate">{name}</span>
      {children}
    </>
  );
}
