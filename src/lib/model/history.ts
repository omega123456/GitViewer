export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  timestamp: number;
  subject: string;
  refs: string;
  lane: number;
  color: number;
  entered: boolean;
  segments: { from: number; to: number; color: number }[];
}
export interface Page {
  commits: Commit[];
  cursor: string | null;
}
export interface Branch {
  name: string;
  remote: boolean;
  current: boolean;
  default: boolean;
  upstream: string;
  gone: boolean;
  worktree?: string;
}
export interface Pruned {
  deleted: string[];
  kept: string[];
}
export interface Stash {
  hash: string;
  selector: string;
  message: string;
  timestamp: number;
}
export interface CommitDetail {
  hash: string;
  author: string;
  timestamp: number;
  subject: string;
  body: string;
}
