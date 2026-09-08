import type { Diff, Status, Settings, Repository } from '../lib/types';
export const settings: Settings = {
  theme: 'light',
  density: 'comfortable',
  diffMode: 'split',
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
