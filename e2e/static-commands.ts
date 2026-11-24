import {
  COMMIT_TIMESTAMP,
  EDITOR_TEXT,
  HASH_A,
  HASH_B,
  HASH_C,
  HASH_T,
  PRIMARY_UNSTAGED_ADDITIONS,
  PRIMARY_UNSTAGED_DELETIONS,
} from './scenario-data';

const WORKTREE_AHEAD_COUNT = 2;
const WORKTREE_APPLY_FILES = 6;
const WORKTREE_APPLY_CONFLICTS = 2;

export const TREE_ROOT = [
  {
    name: 'src',
    path: 'src',
    directory: true,
    ignored: false,
    status: 'M',
  },
  {
    name: '.env.local',
    path: '.env.local',
    directory: false,
    ignored: true,
    status: '',
  },
];

export const TREE_CHILDREN = [
  {
    name: 'app.ts',
    path: 'src/app.ts',
    directory: false,
    ignored: false,
    status: 'M',
  },
];

export const TAURI_METADATA = {
  currentWindow: { label: 'main' },
  currentWebview: { windowLabel: 'main', label: 'main' },
};

export const TAURI_ERRORS = {
  pushRejected: {
    category: 'refused',
    message:
      "To github.com:acme/fixture.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'github.com:acme/fixture.git'\nhint: Updates were rejected because the remote contains work that you do\nhint: not have locally.",
  },
  branchSwitchBlocked: {
    category: 'refused',
    message:
      'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/app.ts\n\tREADME.md\nPlease commit your changes or stash them before you switch branches.\nAborting',
  },
};

export const STATIC_PLUGINS: Record<string, unknown> = {
  'plugin:dialog|open': '/fixture',
  'plugin:dialog|message': 'Ok',
  'plugin:event|unlisten': null,
  'plugin:window|set_title': null,
};

export const STATIC_COMMANDS: Record<string, unknown> = {
  frontend_log: null,
  session_set: null,
  session_close: null,
  env: {
    found: true,
    supported: true,
    version: '2.50.1',
    minimum: '2.38',
  },
  ai_models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'],
  ai_key_set: null,
  ai_generate: {
    message: 'Move stash bulk actions onto the group header',
    source: 'index',
    detail: 'patch',
  },
  worktree_target: {
    path: '/Users/me/Projects/fixture-3f9c2a1',
    free: true,
    label: '3f9c2a1',
  },
  worktree_summary: {
    ahead: WORKTREE_AHEAD_COUNT,
    orphans: 0,
    submodules: false,
  },
  worktree_apply: {
    base: HASH_B,
    tree: HASH_C,
    files: WORKTREE_APPLY_FILES,
    conflicts: WORKTREE_APPLY_CONFLICTS,
  },
  files: [
    'README.md',
    'package.json',
    'public/logo.png',
    'src/app.ts',
    'src/index.css',
    'src/components/shell/CommandPalette.tsx',
    'src-tauri/Cargo.toml',
  ],
  commit_detail: {
    hash: HASH_A,
    author: 'Fixture Author',
    timestamp: COMMIT_TIMESTAMP,
    subject: 'Merge feature',
    body: 'Bring the review work into main.\n\n- Keep the lane colours\n- Show the full message',
  },
  commit_files: {
    statuses: { 'src/app.ts': 'M' },
    lines: {
      'src/app.ts': [PRIMARY_UNSTAGED_ADDITIONS, PRIMARY_UNSTAGED_DELETIONS],
    },
  },
  default_branch: 'main',
  compare_files: {
    base: HASH_B,
    target: HASH_T,
    files: [
      {
        path: 'src/app.ts',
        status: 'M',
        additions: 1,
        deletions: 1,
      },
    ],
  },
  file_read: {
    text: EDITOR_TEXT,
    version: 'v1',
    bom: false,
    crlf: false,
  },
  file_write: { saved: 'v2' },
  unsaved_set: null,
  quit: null,
  refresh: null,
  stash_drop: null,
};
