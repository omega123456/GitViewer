import type {
  Diff,
  DiffStack,
  Status,
  SettingsResponse,
  AiSettings,
  GeneratedMessage,
  Repository,
} from '../lib/types';
export const ai: AiSettings = {
  baseUrl: '',
  model: '',
  prompt:
    'Write a commit message for this diff. One short imperative subject line under 60 characters. Add a body only when needed.',
};
export const settings: SettingsResponse = {
  theme: 'light',
  density: 'comfortable',
  diffMode: 'split',
  updateCheckInterval: '1d',
  installUpdateOnQuit: true,
  searchIgnoredFiles: false,
  smartCommit: 'ask',
  zoom: 100,
  ai,
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
  entries: [
    { kind: 'ordinary', path: 'src/app.ts', index: 'M', worktree: 'M' },
    { kind: 'untracked', path: 'new.txt', index: '?', worktree: '?' },
  ],
};
export const repository: Repository = {
  id: '/fixture',
  name: 'fixture',
  root: '/fixture',
  status,
};
export const diff: Diff = {
  path: 'src/app.ts',
  source: 'unstaged',
  oldMode: null,
  newMode: null,
  binary: false,
  tooLarge: false,
  image: false,
  oldSize: 10,
  newSize: 15,
  oldDimensions: null,
  newDimensions: null,
  content: null,
  added: false,
  patches: ['patch'],
  hunks: [
    {
      header: '@@ -1,2 +1,2 @@',
      oldStart: 1,
      oldCount: 2,
      newStart: 1,
      newCount: 2,
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
          old: 2,
          new: null,
          noNewline: false,
          marks: [
            { text: 'old', changed: true },
            { text: ' value', changed: false },
          ],
        },
        {
          kind: 'add',
          content: 'new value',
          old: null,
          new: 2,
          noNewline: true,
          marks: [
            { text: 'new', changed: true },
            { text: ' value', changed: false },
          ],
        },
      ],
    },
  ],
};
export const stack: DiffStack = {
  files: { 'src/app.ts': diff, 'new.txt': diff },
  truncated: false,
};

export const update: import('../lib/types').UpdateSnapshot = {
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
const numbered = (number: number) =>
  number === 30 || number === 50 ? `changed ${number}` : `line ${number}`;
const context = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    kind: 'context',
    content: numbered(from + index),
    old: from + index,
    new: from + index,
    noNewline: false,
    marks: [],
  }));
export const gapped: Diff = {
  ...diff,
  patches: ['patch', 'patch'],
  hunks: [30, 50].map((changed) => ({
    header: `@@ -${changed - 3},7 +${changed - 3},7 @@`,
    oldStart: changed - 3,
    oldCount: 7,
    newStart: changed - 3,
    newCount: 7,
    lines: [
      ...context(changed - 3, 3),
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
      ...context(changed + 1, 3),
    ],
  })),
};
export const gappedText =
  Array.from({ length: 100 }, (_, index) => numbered(index + 1)).join('\n') +
  '\n';
