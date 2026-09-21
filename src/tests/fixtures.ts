import type {
  Diff,
  Status,
  SettingsResponse,
  AiSettings,
  GeneratedMessage,
  Repository,
} from '../lib/types';
export const ai: AiSettings = {
  enabled: false,
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
