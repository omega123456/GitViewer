import { subMinutes } from 'date-fns';
import type {
  Diff,
  Repository,
  SettingsResponse,
  Status,
  UpdateSnapshot,
} from '../src/lib/types';
import {
  diff,
  gapped,
  gappedText,
  repository,
  settings,
  status,
  update,
} from '../src/tests/fixtures';
import {
  CONTEXT_LINE_TEMPLATE,
  EDITOR_INDEX,
  FETCHED_MINUTES_AGO,
  FROZEN_TIME,
  HISTORY_COMMITS,
  HOTFIX_BRANCH,
  HOTFIX_WORKTREE_ID,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  LONG_CHECKSUM_LINE,
  MARKDOWN_LINES,
  MERGE_CONFLICT_ENTRIES,
  REPOSITORY_PROJECTS,
  SCALE_LINE_COUNT,
  STACK_SCROLL_ENTRY_COUNT,
  STACK_SCROLL_LINE_COUNT,
  STASH_LIST,
  SYKES_PROJECT_PATH,
  WORKTREE_SHORT_OID,
  buildBranches,
  buildLineStats,
  buildWorktrees,
  type WorktreeEntry,
} from './scenario-data';
import {
  STATIC_COMMANDS,
  STATIC_PLUGINS,
  TAURI_ERRORS,
  TAURI_METADATA,
  TREE_CHILDREN,
  TREE_ROOT,
} from './static-commands';

export interface ScenarioConfig {
  diff: Diff;
  generatedLineCount: number;
  stackPaths: string[];
  reposByPath: Record<string, Repository>;
  statusByRepo: Record<string, Status>;
  fallbackRepo: Repository;
  fallbackStatus: Status;
  staticCommands: Record<string, unknown>;
}

export interface MockBundle {
  scenarios: Record<string, ScenarioConfig>;
  staticCommands: Record<string, unknown>;
  staticPlugins: Record<string, unknown>;
  treeRoot: typeof TREE_ROOT;
  treeChildren: typeof TREE_CHILDREN;
  metadata: typeof TAURI_METADATA;
  errors: typeof TAURI_ERRORS;
  contextLineTemplate: typeof CONTEXT_LINE_TEMPLATE;
}

interface ResolvedScenarioOptions {
  settings: SettingsResponse;
  status: Status;
  diff: Diff;
  linked: boolean;
  projects: Record<string, string>;
  includeActiveTab: boolean;
  stashes: typeof STASH_LIST;
  commits: typeof HISTORY_COMMITS;
  update: UpdateSnapshot;
  fileLines: string;
  generatedLineCount: number;
}

type ScenarioOverrides = Partial<ResolvedScenarioOptions>;

interface RepoLookupContext {
  defaultRepoId: string;
  projects: Record<string, string>;
  worktrees: WorktreeEntry[];
}

function createBaseStatus(): Status {
  return {
    ...structuredClone(status),
    fetched: subMinutes(FROZEN_TIME, FETCHED_MINUTES_AGO).toISOString(),
  };
}

function createBaseSettings(): SettingsResponse {
  return {
    ...structuredClone(settings),
    theme: 'system',
  };
}

function defaultScenarioOptions(): ResolvedScenarioOptions {
  return {
    settings: createBaseSettings(),
    status: createBaseStatus(),
    diff: structuredClone(diff),
    linked: false,
    projects: {},
    includeActiveTab: false,
    stashes: [],
    commits: [],
    update: update,
    fileLines: gappedText,
    generatedLineCount: 0,
  };
}

function branchForRepo(
  repoPath: string,
  projects: Record<string, string>,
  worktrees: WorktreeEntry[],
): string {
  const projectBranch = projects[repoPath];
  if (projectBranch) return projectBranch;
  const worktreeBranch = worktrees.find(
    (entry) => entry.id === repoPath,
  )?.branch;
  if (worktreeBranch) return worktreeBranch;
  return '(detached)';
}

function statusForRepo(
  repoPath: string,
  baseStatus: Status,
  context: RepoLookupContext,
): Status {
  if (repoPath === HOTFIX_WORKTREE_ID)
    return { ...baseStatus, branch: HOTFIX_BRANCH };
  if (repoPath === SYKES_PROJECT_PATH)
    return { ...baseStatus, branch: context.projects[repoPath] };
  if (repoPath === context.defaultRepoId) return baseStatus;
  return {
    ...baseStatus,
    branch: branchForRepo(repoPath, context.projects, context.worktrees),
    oid: WORKTREE_SHORT_OID,
    entries: [],
  };
}

function buildRepoMaps(baseStatus: Status, context: RepoLookupContext) {
  const paths = new Set([
    context.defaultRepoId,
    ...Object.keys(context.projects),
    ...context.worktrees.map((entry) => entry.id),
  ]);
  const statusByRepo: Record<string, Status> = {};
  const reposByPath: Record<string, Repository> = {};
  for (const repoPath of paths) {
    const repoStatus = statusForRepo(repoPath, baseStatus, context);
    const isProject = repoPath in context.projects;
    statusByRepo[repoPath] = repoStatus;
    reposByPath[repoPath] = {
      ...repository,
      id: repoPath,
      root: repoPath,
      project: isProject ? repoPath : repository.project,
      status: repoStatus,
    };
  }
  return { statusByRepo: statusByRepo, reposByPath: reposByPath };
}

function buildScenario(overrides: ScenarioOverrides = {}): ScenarioConfig {
  const options: ResolvedScenarioOptions = {
    ...defaultScenarioOptions(),
    ...overrides,
  };
  const worktrees = buildWorktrees(repository.id, options.linked);
  const { statusByRepo, reposByPath } = buildRepoMaps(options.status, {
    defaultRepoId: repository.id,
    projects: options.projects,
    worktrees: worktrees,
  });
  const tabPaths = [
    ...Object.keys(options.projects),
    ...(options.includeActiveTab ? [repository.id] : []),
  ];
  const fallbackStatus: Status = {
    ...options.status,
    branch: '(detached)',
    oid: WORKTREE_SHORT_OID,
    entries: [],
  };
  return {
    diff: options.diff,
    generatedLineCount: options.generatedLineCount,
    stackPaths: [
      'src/app.ts',
      ...options.status.entries.map((entry) => entry.path),
    ],
    reposByPath: reposByPath,
    statusByRepo: statusByRepo,
    fallbackStatus: fallbackStatus,
    fallbackRepo: { ...repository, status: fallbackStatus },
    staticCommands: {
      session_get: {
        tabs: tabPaths.map((path) => ({ path: path, message: '' })),
        active: repository.id,
      },
      update_get: options.update,
      settings_get: options.settings,
      worktrees: worktrees,
      stashes: options.stashes,
      history: { commits: options.commits, cursor: null },
      line_stats: buildLineStats(options.status.entries),
      branches: buildBranches(options.linked),
      file_lines: options.fileLines,
    },
  };
}

function buildImageScenario(): ScenarioConfig {
  const scenarioStatus = createBaseStatus();
  const scenarioDiff = structuredClone(diff);
  scenarioStatus.entries = [
    { ...scenarioStatus.entries[0], path: 'picture.png' },
  ];
  scenarioDiff.path = 'picture.png';
  scenarioDiff.image = true;
  scenarioDiff.oldDimensions = { width: IMAGE_WIDTH, height: IMAGE_HEIGHT };
  scenarioDiff.newDimensions = { width: IMAGE_WIDTH, height: IMAGE_HEIGHT };
  return buildScenario({ status: scenarioStatus, diff: scenarioDiff });
}

function buildMarkdownScenario(): ScenarioConfig {
  const scenarioStatus = createBaseStatus();
  const scenarioDiff = structuredClone(diff);
  scenarioStatus.entries = [
    { ...scenarioStatus.entries[0], path: 'README.md' },
  ];
  scenarioDiff.path = 'README.md';
  scenarioDiff.hunks[0].lines = MARKDOWN_LINES;
  return buildScenario({ status: scenarioStatus, diff: scenarioDiff });
}

function buildLongScenario(): ScenarioConfig {
  const scenarioDiff = structuredClone(diff);
  scenarioDiff.hunks[0].lines = scenarioDiff.hunks[0].lines.map(
    (line, index) => ({
      ...line,
      content: index === 1 ? LONG_CHECKSUM_LINE : line.content,
    }),
  );
  return buildScenario({ diff: scenarioDiff });
}

function buildStackScrollScenario(): ScenarioConfig {
  const scenarioStatus = createBaseStatus();
  const firstEntry = scenarioStatus.entries[0];
  scenarioStatus.entries = Array.from(
    Array(STACK_SCROLL_ENTRY_COUNT).keys(),
    (index) => ({
      ...firstEntry,
      path: index === 0 ? 'src/app.ts' : `src/file${index}.ts`,
    }),
  );
  return buildScenario({
    status: scenarioStatus,
    generatedLineCount: STACK_SCROLL_LINE_COUNT,
  });
}

function buildAiScenario(): ScenarioConfig {
  const scenarioSettings = createBaseSettings();
  scenarioSettings.keyStored = true;
  scenarioSettings.ai = {
    ...scenarioSettings.ai,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  };
  return buildScenario({ settings: scenarioSettings });
}

function buildMergeScenario(): ScenarioConfig {
  return buildScenario({
    status: {
      ...createBaseStatus(),
      conflicted: true,
      merging: 'feature',
      entries: MERGE_CONFLICT_ENTRIES,
    },
  });
}

function buildUpdateScenario(): ScenarioConfig {
  return buildScenario({
    update: {
      ...update,
      availability: 'enabled',
      phase: 'ready',
      available: {
        version: '0.2.0',
        notes: 'Automatic updates and improved repository browsing.',
        date: '2026-09-06T00:00:00Z',
      },
    },
  });
}

export function buildMockBundle(): MockBundle {
  return {
    scenarios: {
      default: buildScenario(),
      ai: buildAiScenario(),
      compare: buildScenario({
        status: { ...createBaseStatus(), branch: 'feature' },
      }),
      context: buildScenario({ diff: { ...structuredClone(diff), ...gapped } }),
      merge: buildMergeScenario(),
      image: buildImageScenario(),
      markdown: buildMarkdownScenario(),
      long: buildLongScenario(),
      scale: buildScenario({ generatedLineCount: SCALE_LINE_COUNT }),
      'stack-scroll': buildStackScrollScenario(),
      worktrees: buildScenario({ linked: true }),
      repositories: buildScenario({
        projects: REPOSITORY_PROJECTS,
        includeActiveTab: true,
      }),
      stash: buildScenario({ stashes: STASH_LIST }),
      history: buildScenario({ commits: HISTORY_COMMITS }),
      update: buildUpdateScenario(),
      editor: buildScenario({ fileLines: EDITOR_INDEX }),
    },
    staticCommands: STATIC_COMMANDS,
    staticPlugins: STATIC_PLUGINS,
    treeRoot: TREE_ROOT,
    treeChildren: TREE_CHILDREN,
    metadata: TAURI_METADATA,
    errors: TAURI_ERRORS,
    contextLineTemplate: CONTEXT_LINE_TEMPLATE,
  };
}
