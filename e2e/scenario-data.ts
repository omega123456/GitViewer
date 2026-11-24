import { getUnixTime, parseISO, subDays, subHours, subWeeks } from 'date-fns';
import type { StatusEntry } from '../src/lib/types';

export const FROZEN_TIME = parseISO('2026-09-07T00:00:00Z');
export const FETCHED_MINUTES_AGO = 2;
export const FULL_HASH_LENGTH = 40;
export const WORKTREE_SHORT_OID = '3f9c2a1b';
export const IMAGE_WIDTH = 320;
export const IMAGE_HEIGHT = 180;
export const SCALE_LINE_COUNT = 20000;
export const STACK_SCROLL_LINE_COUNT = 60;
export const STACK_SCROLL_ENTRY_COUNT = 40;
export const HOTFIX_WORKTREE_ID = '/worktrees/gv-hotfix';
export const HOTFIX_BRANCH = 'fix/watcher-gitdir';
export const REVIEW_WORKTREE_ID = '/worktrees/gv-review';
export const SYKES_PROJECT_PATH = '/Users/me/work/sykes-reservations';
export const AXOPANE_PROJECT_PATH = '/Users/me/Projects/axopane';

const STASH_HOURS_AGO = 2;
const STASH_DAYS_AGO = 3;
const STASH_WEEKS_AGO = 2;
const STAGED_ADDITIONS = 3;
const STAGED_DELETIONS = 1;
export const PRIMARY_UNSTAGED_ADDITIONS = 12;
export const PRIMARY_UNSTAGED_DELETIONS = 3;
const SECONDARY_UNSTAGED_ADDITIONS = 27;
const SECONDARY_UNSTAGED_DELETIONS = 0;

export const HASH_A = 'a'.repeat(FULL_HASH_LENGTH);
export const HASH_B = 'b'.repeat(FULL_HASH_LENGTH);
export const HASH_C = 'c'.repeat(FULL_HASH_LENGTH);
export const HASH_T = 't'.repeat(FULL_HASH_LENGTH);
export const COMMIT_TIMESTAMP = getUnixTime(parseISO('2023-11-14T22:13:20Z'));

export interface ContextLineTemplate {
  kind: 'context';
  noNewline: boolean;
  marks: [number, number][];
}

export const CONTEXT_LINE_TEMPLATE: ContextLineTemplate = {
  kind: 'context',
  noNewline: false,
  marks: [],
};

export const EDITOR_TEXT = [
  "import { createHighlighter, bundledLanguages } from 'shiki';",
  'const aliases: Record<string, string> = {',
  "  ts: 'typescript',",
  "  rs: 'rust',",
  '};',
  'let highlighter: ReturnType<typeof createHighlighter> | undefined;',
  'export async function highlight(content: string, path: string, dark: boolean) {',
  "  const extension = path.split('.').pop()?.toLowerCase() ?? '';",
  "  const theme = dark ? 'github-dark' : 'github-light';",
  '  const language = aliases[extension] ?? extension;',
  '  if (!(language in bundledLanguages))',
  "    return content.split('\\n');",
  '  highlighter ??= createHighlighter({ themes: [theme], langs: [] });',
  '  return highlighter;',
  '}',
  '',
].join('\n');

export const EDITOR_INDEX = EDITOR_TEXT.replace(
  "  rs: 'rust',\n",
  "  rs: 'rust',\n  py: 'python',\n",
)
  .replace(', dark: boolean) {', ') {')
  .replace("  const theme = dark ? 'github-dark' : 'github-light';\n", '');

export const LONG_CHECKSUM_LINE =
  'const checksum = "d22053281f852e11534f5198498373cbb59295120a20771d90f7ed1897490a72d22053281f852e11534f5198";';

export const MARKDOWN_LINES = [
  '# GitViewer',
  '',
  'A Tauri 2 desktop git client.',
  '',
  '## Install',
  '',
  '```bash',
  'pnpm install',
  '```',
  '',
  '## Commands',
  '',
  '- `pnpm dev` runs the app',
  '- `pnpm typecheck` checks the types',
].map((content, index) => ({
  ...CONTEXT_LINE_TEMPLATE,
  content: content,
  old: index + 1,
  new: index + 1,
}));

export const STASH_LIST = [
  {
    hash: HASH_A,
    selector: 'stash@{0}',
    message: 'WIP on main: parser rewrite',
    timestamp: getUnixTime(subHours(FROZEN_TIME, STASH_HOURS_AGO)),
  },
  {
    hash: HASH_B,
    selector: 'stash@{1}',
    message: 'Spike: virtual list overscan',
    timestamp: getUnixTime(subDays(FROZEN_TIME, STASH_DAYS_AGO)),
  },
  {
    hash: HASH_C,
    selector: 'stash@{2}',
    message: 'WIP on main: token cleanup',
    timestamp: getUnixTime(subWeeks(FROZEN_TIME, STASH_WEEKS_AGO)),
  },
];

export const HISTORY_COMMITS = [
  {
    hash: HASH_A,
    parents: [HASH_B, HASH_C],
    author: 'Fixture Author',
    timestamp: COMMIT_TIMESTAMP,
    subject: 'Merge feature',
    refs: 'main',
    lane: 0,
    color: 0,
    entered: false,
    segments: [
      { from: 0, to: 0, color: 0 },
      { from: 0, to: 1, color: 1 },
    ],
  },
  {
    hash: HASH_B,
    parents: [HASH_C],
    author: 'Fixture Author',
    timestamp: COMMIT_TIMESTAMP,
    subject: 'Review implementation',
    refs: 'feature',
    lane: 0,
    color: 0,
    entered: true,
    segments: [
      { from: 1, to: 0, color: 1 },
      { from: 0, to: 0, color: 0 },
    ],
  },
  {
    hash: HASH_C,
    parents: [],
    author: 'Fixture Author',
    timestamp: COMMIT_TIMESTAMP,
    subject: 'Initial commit',
    refs: '',
    lane: 0,
    color: 0,
    entered: true,
    segments: [],
  },
];

export const MERGE_CONFLICT_ENTRIES: StatusEntry[] = [
  {
    kind: 'unmerged',
    path: 'src/app.ts',
    stage: 'UU',
    modes: ['100644', '100644', '100644', '100644'],
    hashes: ['a', 'b', 'c'],
    index: 'C',
    worktree: 'C',
  },
];

export const REPOSITORY_PROJECTS: Record<string, string> = {
  [AXOPANE_PROJECT_PATH]: 'main',
  [SYKES_PROJECT_PATH]: 'feature/pets-rules',
};

export interface WorktreeEntry {
  id: string;
  name: string | undefined;
  main: boolean;
  bare: boolean;
  branch: string;
  oid: string;
  detached: boolean;
  locked: string | null;
  prunable: boolean;
  missing: boolean;
}

interface WorktreeInput {
  id: string;
  branch: string;
  mainRepoId: string;
  extra?: Partial<WorktreeEntry>;
}

function createWorktree(input: WorktreeInput): WorktreeEntry {
  return {
    id: input.id,
    name: input.id.split('/').at(-1),
    main: input.id === input.mainRepoId,
    bare: false,
    branch: input.branch,
    oid: WORKTREE_SHORT_OID.padEnd(FULL_HASH_LENGTH, '0'),
    detached: false,
    locked: null,
    prunable: false,
    missing: false,
    ...input.extra,
  };
}

export function buildWorktrees(
  mainRepoId: string,
  linked: boolean,
): WorktreeEntry[] {
  const mainWorktree = createWorktree({
    id: mainRepoId,
    branch: 'main',
    mainRepoId: mainRepoId,
  });
  if (!linked) return [mainWorktree];
  return [
    mainWorktree,
    createWorktree({
      id: HOTFIX_WORKTREE_ID,
      branch: HOTFIX_BRANCH,
      mainRepoId: mainRepoId,
    }),
    createWorktree({
      id: REVIEW_WORKTREE_ID,
      branch: 'feature',
      mainRepoId: mainRepoId,
    }),
    createWorktree({
      id: '/worktrees/gv-spike',
      branch: '',
      mainRepoId: mainRepoId,
      extra: { detached: true },
    }),
    createWorktree({
      id: '/worktrees/gv-release',
      branch: 'release/2.20',
      mainRepoId: mainRepoId,
      extra: { locked: 'on external drive' },
    }),
    createWorktree({
      id: '/worktrees/gv-legacy',
      branch: 'feature/legacy-sync',
      mainRepoId: mainRepoId,
      extra: { missing: true, prunable: true },
    }),
  ];
}

export function buildBranches(linked: boolean) {
  return [
    {
      name: 'main',
      remote: false,
      current: true,
      default: true,
      upstream: 'origin/main',
      gone: false,
    },
    {
      name: 'old-login',
      remote: false,
      current: false,
      default: false,
      upstream: 'origin/old-login',
      gone: true,
    },
    {
      name: 'feature',
      remote: false,
      current: false,
      default: false,
      upstream: '',
      gone: false,
      ...(linked ? { worktree: REVIEW_WORKTREE_ID } : {}),
    },
  ];
}

function stagedStatsFor(path: string): [number, number] | null {
  if (path.endsWith('.png')) return null;
  return [STAGED_ADDITIONS, STAGED_DELETIONS];
}

function unstagedStatsFor(
  path: string,
  index: number,
): [number, number] | null {
  if (path.endsWith('.png')) return null;
  if (index === 0)
    return [PRIMARY_UNSTAGED_ADDITIONS, PRIMARY_UNSTAGED_DELETIONS];
  return [SECONDARY_UNSTAGED_ADDITIONS, SECONDARY_UNSTAGED_DELETIONS];
}

export function buildLineStats(entries: StatusEntry[]) {
  return {
    staged: Object.fromEntries(
      entries.map((entry) => [entry.path, stagedStatsFor(entry.path)]),
    ),
    unstaged: Object.fromEntries(
      entries.map((entry, index) => [
        entry.path,
        unstagedStatsFor(entry.path, index),
      ]),
    ),
  };
}
