export interface GitError {
  category: string;
  message: string;
}
export interface Environment {
  found: boolean;
  supported: boolean;
  version: string;
  minimum: string;
}
interface EntryRecord {
  path: string;
  index: string;
  worktree: string;
}
export type Entry =
  | (EntryRecord & { kind: 'untracked' })
  | (EntryRecord & { kind: 'ordinary' })
  | (EntryRecord & { kind: 'renamed'; originalPath: string; score: string })
  | (EntryRecord & {
      kind: 'unmerged';
      stage: string;
      modes: string[];
      hashes: string[];
    });
export interface Status {
  branch: string;
  oid: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  entries: Entry[];
  conflicted: boolean;
  merging: string | null;
  fetched: string | null;
}
export interface MergePreview {
  outcome: 'upToDate' | 'fastForward' | 'commit' | 'conflict';
  changed: number;
  conflicts: string[];
}
export interface Repository {
  id: string;
  name: string;
  root: string;
  project: string;
  status: Status;
}
export interface TreeEntry {
  path: string;
  name: string;
  directory: boolean;
  ignored: boolean;
  status: string;
}
export type Source =
  'staged' | 'unstaged' | 'file' | 'commit' | 'stash' | 'compare';
export interface Selection {
  path: string;
  source: Source;
  revision?: string;
  base?: string;
  blame?: boolean;
  rendered?: boolean;
  editing?: boolean;
}
