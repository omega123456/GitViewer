export interface GitError {
  category: string;
  message: string;
}
export interface Environment {
  found: boolean;
  supported: boolean;
  version: string;
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
}
export interface Repository {
  id: string;
  name: string;
  root: string;
  status: Status;
}
export interface TreeEntry {
  path: string;
  name: string;
  directory: boolean;
  ignored: boolean;
  status: string;
}
export type Source = 'staged' | 'unstaged' | 'file' | 'commit' | 'stash';
export interface Selection {
  path: string;
  source: Source;
  revision?: string;
  blame?: boolean;
}
export interface UpdateSnapshot {
  currentVersion: string;
  availability: 'enabled' | 'development' | 'unconfigured';
  available: {
    version: string;
    notes: string | null;
    date: string | null;
  } | null;
  lastChecked: string | null;
  phase:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'saving'
    | 'installing'
    | 'error';
  downloaded: number;
  total: number | null;
  error: string | null;
  canQuitWithoutUpdating: boolean;
}
export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  prompt: string;
}
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  density: 'compact' | 'comfortable';
  diffMode: 'split' | 'unified';
  updateCheckInterval: '1h' | '5h' | '1d' | '7d' | 'off';
  installUpdateOnQuit: boolean;
  ai: AiSettings;
}
export interface SettingsResponse extends Settings {
  keyStored: boolean;
}
export interface GeneratedMessage {
  message: string;
  source: 'index' | 'workingTree';
  detail: 'patch' | 'summary';
}
export interface Mark {
  text: string;
  changed: boolean;
}
export interface DiffLine {
  kind: string;
  content: string;
  old: number | null;
  new: number | null;
  noNewline: boolean;
  marks: Mark[];
}
export interface Hunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}
export interface Diff {
  path: string;
  source: Source;
  oldMode: string | null;
  newMode: string | null;
  binary: boolean;
  tooLarge: boolean;
  hunks: Hunk[];
  patches: string[];
  content: string | null;
  image: boolean;
  oldSize: number;
  newSize: number;
  oldDimensions: Dimensions | null;
  newDimensions: Dimensions | null;
}
export interface Dimensions {
  width: number;
  height: number;
}
export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  timestamp: number;
  subject: string;
  refs: string;
  lane: number;
  segments: { from: number; to: number }[];
}
export interface Page {
  commits: Commit[];
  cursor: string | null;
}
export interface Branch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string;
}
export interface Stash {
  hash: string;
  selector: string;
  message: string;
  timestamp: number;
}
export interface Blame {
  hash: string;
  author: string;
  timestamp: number;
  line: number;
  content: string;
  block: boolean;
}
type RepoArgs = { repo: string };
type FileArgs = RepoArgs & { path: string };
type Command<A, R> = { args: A; result: R };
export interface Session {
  tabs: { path: string; message: string }[];
  active: string;
}
export interface Commands {
  update_get: Command<Record<string, never>, UpdateSnapshot>;
  update_check: Command<Record<string, never>, UpdateSnapshot>;
  update_install: Command<Record<string, never>, UpdateSnapshot>;
  update_quit: Command<Record<string, never>, UpdateSnapshot>;
  frontend_log: Command<{ message: string }, null>;
  session_get: Command<Record<string, never>, Session>;
  session_set: Command<Session, null>;
  session_close: Command<Session, null>;
  env: Command<Record<string, never>, Environment>;
  repo_open: Command<{ path: string }, Repository>;
  repo_close: Command<RepoArgs, null>;
  status: Command<RepoArgs, Status>;
  refresh: Command<RepoArgs, null>;
  tree: Command<FileArgs, TreeEntry[]>;
  files: Command<RepoArgs, string[]>;
  diff: Command<
    FileArgs & {
      source: Source;
      revision?: string;
      context?: number;
      overrideLimit?: boolean;
    },
    Diff
  >;
  files_action: Command<
    RepoArgs & {
      paths: string[];
      action: 'stage' | 'unstage' | 'discard' | 'revert';
    },
    null
  >;
  hunk_action: Command<
    FileArgs & {
      source: Source;
      hunk: number;
      context?: number;
      patch: string;
      action: string;
    },
    null
  >;
  commit: Command<RepoArgs & { message: string }, null>;
  settings_get: Command<Record<string, never>, SettingsResponse>;
  settings_set: Command<Settings, Settings>;
  ai_models: Command<Record<string, never>, string[]>;
  ai_key_set: Command<{ key: string }, null>;
  ai_generate: Command<RepoArgs, GeneratedMessage>;
  branches: Command<RepoArgs, Branch[]>;
  branch_switch: Command<RepoArgs & { name: string }, null>;
  branch_create: Command<
    RepoArgs & { name: string; base: string; checkout: boolean },
    null
  >;
  branch_delete: Command<RepoArgs & { name: string }, null>;
  smart_checkout: Command<RepoArgs & { name: string }, null>;
  sync: Command<RepoArgs & { action: string }, null>;
  history: Command<RepoArgs & { path?: string; cursor?: string }, Page>;
  commit_files: Command<
    RepoArgs & { revision: string; source?: Source },
    string[]
  >;
  blame: Command<FileArgs, Blame[]>;
  stashes: Command<RepoArgs, Stash[]>;
  stash_save: Command<RepoArgs & { message: string }, string>;
  stash_apply: Command<
    RepoArgs & { hash: string; pop: boolean; smart: boolean },
    null
  >;
  stash_drop: Command<RepoArgs & { hash: string }, null>;
  system_open: Command<FileArgs, null>;
}
export interface Events {
  'update://changed': null;
  'session://close-cancelled': null;
  'session://save-requested': null;
  'repo://closed': RepoArgs;
  'repo://status-changed': RepoArgs;
  'repo://head-changed': RepoArgs;
  'settings://changed': null;
  'sync://progress': RepoArgs & { message: string; done: boolean };
}
