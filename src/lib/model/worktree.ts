export interface Worktree {
  id: string;
  name: string;
  main: boolean;
  bare: boolean;
  branch: string;
  oid: string;
  detached: boolean;
  locked: string | null;
  prunable: boolean;
  missing: boolean;
}
export type WorktreeMode = 'detached' | 'new' | 'existing';
export interface WorktreeTarget {
  path: string;
  free: boolean;
  label: string;
}
export interface WorktreeSummary {
  ahead: number;
  orphans: number;
  submodules: boolean;
}
export interface Applied {
  base: string;
  tree: string;
  files: number;
  conflicts: number;
}
