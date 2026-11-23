const COMPACT_TREE_ROW_HEIGHT = 24;
const COMFORTABLE_TREE_ROW_HEIGHT = 28;
const COMPACT_REVISION_ROW_HEIGHT = 22;
const COMFORTABLE_REVISION_ROW_HEIGHT = 26;
const INDENT_PER_LEVEL = 16;
const INDENT_BASE = 6;
export const TREE_OVERSCAN = 8;
export function treeRowHeight(compact: boolean) {
  return compact ? COMPACT_TREE_ROW_HEIGHT : COMFORTABLE_TREE_ROW_HEIGHT;
}
export function revisionRowHeight(compact: boolean) {
  return compact
    ? COMPACT_REVISION_ROW_HEIGHT
    : COMFORTABLE_REVISION_ROW_HEIGHT;
}
export function treeIndent(level: number) {
  return `${level * INDENT_PER_LEVEL + INDENT_BASE}px`;
}
