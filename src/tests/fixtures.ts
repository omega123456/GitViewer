import type {
  AiSettings,
  Branch,
  Diff,
  DiffStack,
  Environment,
  GeneratedMessage,
  Repository,
  SettingsResponse,
  Status,
  UpdateSnapshot,
  Worktree,
} from '../lib/types';

export const HASH_LENGTH = 40;
export const COMMIT_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
export const COMMIT_TIMESTAMP = 1700000000;
const DEFAULT_ZOOM = 100;
const DEFAULT_FILE_TAB_LIMIT = 8;
const DIFF_OLD_SIZE = 10;
const DIFF_NEW_SIZE = 15;
const DIFF_HUNK_LINES = 2;
const DIFF_SECOND_LINE = 2;
const MARK_WORD_END = 3;
const FIRST_GAP_LINE = 30;
const SECOND_GAP_LINE = 50;
const CONTEXT_LINE_COUNT = 3;
const GAPPED_HUNK_SPAN = 7;
const GAPPED_TOTAL_LINES = 100;

export const envMock: Environment = {
  found: true,
  supported: true,
  version: '2.50.1',
  minimum: '2.38',
};

export function identity<T>(value: T): T {
  return value;
}

export function worktreeFixture(
  id: string,
  extra: Partial<Worktree> = {},
): Worktree {
  return {
    id: id,
    name: id.split('/').at(-1) ?? id,
    main: false,
    bare: false,
    branch: '',
    oid: COMMIT_HASH,
    detached: false,
    locked: null,
    prunable: false,
    missing: false,
    ...extra,
  };
}

export function branchFixture(
  name: string,
  extra: Partial<Branch> = {},
): Branch {
  return {
    name: name,
    remote: false,
    current: false,
    default: false,
    upstream: '',
    gone: false,
    ...extra,
  };
}

export const ai: AiSettings = {
  baseUrl: '',
  model: '',
  prompt:
    'Write a concise commit message for this diff (under 220 characters total).\n' +
    '- Subject line: Imperative mood, under 72 characters, summarizing the core functional change.\n' +
    '- Body (when needed): 1–2 short sentences explaining *why* the change was made or how behavior changed.\n' +
    '- Rules: Describe functional impact and intent, not code mechanics. Do not name specific classes/functions or mention routine test updates.',
};

export const settings: SettingsResponse = {
  theme: 'light',
  density: 'comfortable',
  diffMode: 'split',
  updateCheckInterval: '1d',
  installUpdateOnQuit: true,
  searchIgnoredFiles: false,
  smartCommit: 'ask',
  zoom: DEFAULT_ZOOM,
  maxFileTabs: DEFAULT_FILE_TAB_LIMIT,
  pullOnCheckout: false,
  autoFetchInterval: 'off',
  ai: ai,
  keyStored: false,
};

export const generated: GeneratedMessage = {
  message: 'Add a generated commit message',
  source: 'index',
  detail: 'patch',
};

export const status: Status = {
  branch: 'main',
  oid: 'abc123456',
  upstream: 'origin/main',
  ahead: 1,
  behind: 0,
  conflicted: false,
  merging: null,
  fetched: null,
  entries: [
    { kind: 'ordinary', path: 'src/app.ts', index: 'M', worktree: 'M' },
    { kind: 'untracked', path: 'new.txt', index: '?', worktree: '?' },
  ],
};

export const repository: Repository = {
  id: '/fixture',
  name: 'fixture',
  root: '/fixture',
  project: '/fixture',
  status: status,
};

export const diff: Diff = {
  path: 'src/app.ts',
  source: 'unstaged',
  oldMode: null,
  newMode: null,
  binary: false,
  tooLarge: false,
  image: false,
  oldSize: DIFF_OLD_SIZE,
  newSize: DIFF_NEW_SIZE,
  oldDimensions: null,
  newDimensions: null,
  content: null,
  added: false,
  patches: ['patch'],
  hunks: [
    {
      header: '@@ -1,2 +1,2 @@',
      oldStart: 1,
      oldCount: DIFF_HUNK_LINES,
      newStart: 1,
      newCount: DIFF_HUNK_LINES,
      lines: [
        {
          kind: 'context',
          content: 'const unchanged = true;',
          old: 1,
          new: 1,
          noNewline: false,
          marks: [],
        },
        {
          kind: 'remove',
          content: 'old value',
          old: DIFF_SECOND_LINE,
          new: null,
          noNewline: false,
          marks: [[0, MARK_WORD_END]],
        },
        {
          kind: 'add',
          content: 'new value',
          old: null,
          new: DIFF_SECOND_LINE,
          noNewline: true,
          marks: [[0, MARK_WORD_END]],
        },
      ],
    },
  ],
};

export const stack: DiffStack = {
  files: { 'src/app.ts': diff, 'new.txt': diff },
  truncated: false,
};

export const update: UpdateSnapshot = {
  currentVersion: '0.1.0',
  availability: 'development',
  available: null,
  lastChecked: null,
  phase: 'idle',
  downloaded: 0,
  total: null,
  error: null,
  canQuitWithoutUpdating: false,
};

function numbered(lineNumber: number) {
  const isChanged =
    lineNumber === FIRST_GAP_LINE || lineNumber === SECOND_GAP_LINE;
  return isChanged ? `changed ${lineNumber}` : `line ${lineNumber}`;
}

function contextLines(
  from: number,
  lineCount: number,
): Diff['hunks'][number]['lines'] {
  return Array.from({ length: lineCount }, (_unused, index) => ({
    kind: 'context',
    content: numbered(from + index),
    old: from + index,
    new: from + index,
    noNewline: false,
    marks: [],
  }));
}

export const gapped: Diff = {
  ...diff,
  patches: ['patch', 'patch'],
  hunks: [FIRST_GAP_LINE, SECOND_GAP_LINE].map((changed) => ({
    header: `@@ -${changed - CONTEXT_LINE_COUNT},${GAPPED_HUNK_SPAN} +${changed - CONTEXT_LINE_COUNT},${GAPPED_HUNK_SPAN} @@`,
    oldStart: changed - CONTEXT_LINE_COUNT,
    oldCount: GAPPED_HUNK_SPAN,
    newStart: changed - CONTEXT_LINE_COUNT,
    newCount: GAPPED_HUNK_SPAN,
    lines: [
      ...contextLines(changed - CONTEXT_LINE_COUNT, CONTEXT_LINE_COUNT),
      {
        kind: 'remove',
        content: `line ${changed}`,
        old: changed,
        new: null,
        noNewline: false,
        marks: [],
      },
      {
        kind: 'add',
        content: `changed ${changed}`,
        old: null,
        new: changed,
        noNewline: false,
        marks: [],
      },
      ...contextLines(changed + 1, CONTEXT_LINE_COUNT),
    ],
  })),
};

export const gappedText =
  Array.from({ length: GAPPED_TOTAL_LINES }, (_unused, index) =>
    numbered(index + 1),
  ).join('\n') + '\n';
