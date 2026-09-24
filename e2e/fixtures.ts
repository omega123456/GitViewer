import { getUnixTime, parseISO, subDays, subHours, subWeeks } from 'date-fns';
import { test as base, expect } from '@playwright/test';
import {
  diff,
  gapped,
  gappedText,
  repository,
  settings,
  status,
  update,
} from '../src/tests/fixtures';
const frozen = parseISO('2026-09-07T00:00:00Z');
const stashes = [
  {
    hash: 'a'.repeat(40),
    selector: 'stash@{0}',
    message: 'WIP on main: parser rewrite',
    timestamp: getUnixTime(subHours(frozen, 2)),
  },
  {
    hash: 'b'.repeat(40),
    selector: 'stash@{1}',
    message: 'Spike: virtual list overscan',
    timestamp: getUnixTime(subDays(frozen, 3)),
  },
  {
    hash: 'c'.repeat(40),
    selector: 'stash@{2}',
    message: 'WIP on main: token cleanup',
    timestamp: getUnixTime(subWeeks(frozen, 2)),
  },
];
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({
        diff,
        gapped,
        gappedText,
        repository,
        settings,
        status,
        stashes,
        update,
      }) => {
        Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
          value: { unregisterListener: () => {} },
        });
        Object.defineProperty(window, '__TAURI_OS_PLUGIN_INTERNALS__', {
          value: { platform: 'macos' },
        });
        const scenario = new URLSearchParams(window.location.search).get(
          'scenario',
        );
        if (scenario === 'ai') {
          settings.keyStored = true;
          settings.ai = {
            ...settings.ai,
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
          };
        }
        if (scenario === 'compare') status.branch = 'feature';
        if (scenario === 'context') Object.assign(diff, gapped);
        if (scenario === 'merge') {
          status.conflicted = true;
          status.merging = 'feature';
          status.entries = [
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
        }
        if (scenario === 'image') {
          status.entries = [{ ...status.entries[0], path: 'picture.png' }];
          diff.path = 'picture.png';
          diff.image = true;
          diff.oldDimensions = { width: 320, height: 180 };
          diff.newDimensions = { width: 320, height: 180 };
        }
        if (scenario === 'markdown') {
          status.entries = [{ ...status.entries[0], path: 'README.md' }];
          diff.path = 'README.md';
          diff.hunks[0].lines = [
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
            kind: 'context',
            content,
            old: index + 1,
            new: index + 1,
            noNewline: false,
            marks: [],
          }));
        }
        if (scenario === 'long') {
          diff.hunks[0].lines = diff.hunks[0].lines.map((line, index) => ({
            ...line,
            content:
              index === 1
                ? `const checksum = "d22053281f852e11534f5198498373cbb59295120a20771d90f7ed1897490a72d22053281f852e11534f5198";`
                : line.content,
          }));
        }
        if (scenario === 'scale' || scenario === 'stack-scroll') {
          if (scenario === 'stack-scroll')
            status.entries = Array.from({ length: 40 }, (_, index) => ({
              ...status.entries[0],
              path: index === 0 ? 'src/app.ts' : `src/file${index}.ts`,
            }));
          diff.hunks[0].lines = Array.from(
            { length: scenario === 'stack-scroll' ? 60 : 20000 },
            (_, index) => ({
              kind: 'context',
              content: `const row${index} = ${index};`,
              old: index + 1,
              new: index + 1,
              noNewline: false,
              marks: [],
            }),
          );
        }
        let callback = 0;
        const listeners = new Map<number, (value: unknown) => void>();
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
          value: {
            transformCallback: (handler: (value: unknown) => void) => {
              const id = ++callback;
              listeners.set(id, handler);
              return id;
            },
            unregisterCallback: (id: number) => listeners.delete(id),
            convertFileSrc: (path: string, protocol: string) =>
              `http://${protocol}.localhost/${path}`,
            invoke: async (
              name: string,
              payload: { command: string; args: Record<string, string> },
            ) => {
              if (name === 'plugin:dialog|open') return '/fixture';
              if (name === 'plugin:dialog|message') return 'Ok';
              if (name === 'plugin:event|listen') return ++callback;
              if (name === 'plugin:event|unlisten') return null;
              if (name === 'execute') {
                switch (payload.command) {
                  case 'session_get':
                    return { tabs: [], active: '' };
                  case 'frontend_log':
                  case 'session_set':
                  case 'session_close':
                    return null;
                  case 'update_get':
                    return scenario === 'update'
                      ? {
                          ...update,
                          availability: 'enabled',
                          phase: 'ready',
                          available: {
                            version: '0.2.0',
                            notes:
                              'Automatic updates and improved repository browsing.',
                            date: '2026-09-06T00:00:00Z',
                          },
                        }
                      : update;
                  case 'env':
                    return { found: true, supported: true, version: '2.50.1' };
                  case 'settings_get':
                    return settings;
                  case 'ai_models':
                    return ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'];
                  case 'ai_key_set':
                    return null;
                  case 'ai_generate':
                    return {
                      message: 'Move stash bulk actions onto the group header',
                      source: 'index',
                      detail: 'patch',
                    };
                  case 'repo_open':
                    return repository;
                  case 'status':
                    return status;
                  case 'files':
                    return [
                      'README.md',
                      'package.json',
                      'public/logo.png',
                      'src/app.ts',
                      'src/index.css',
                      'src/components/shell/CommandPalette.tsx',
                      'src-tauri/Cargo.toml',
                    ];
                  case 'stashes':
                    return scenario === 'stash' ? stashes : [];
                  case 'history':
                    return {
                      commits:
                        scenario === 'history'
                          ? [
                              {
                                hash: 'a'.repeat(40),
                                parents: ['b'.repeat(40), 'c'.repeat(40)],
                                author: 'Fixture Author',
                                timestamp: 1700000000,
                                subject: 'Merge feature',
                                refs: 'main',
                                lane: 0,
                                segments: [
                                  { from: 0, to: 0 },
                                  { from: 0, to: 1 },
                                ],
                              },
                              {
                                hash: 'b'.repeat(40),
                                parents: ['c'.repeat(40)],
                                author: 'Fixture Author',
                                timestamp: 1700000000,
                                subject: 'Review implementation',
                                refs: 'feature',
                                lane: 0,
                                segments: [
                                  { from: 0, to: 0 },
                                  { from: 1, to: 0 },
                                ],
                              },
                              {
                                hash: 'c'.repeat(40),
                                parents: [],
                                author: 'Fixture Author',
                                timestamp: 1700000000,
                                subject: 'Initial commit',
                                refs: '',
                                lane: 0,
                                segments: [],
                              },
                            ]
                          : [],
                      cursor: null,
                    };
                  case 'commit_files':
                    return { 'src/app.ts': 'M' };
                  case 'branches':
                    return [
                      {
                        name: 'main',
                        remote: false,
                        current: true,
                        upstream: '',
                      },
                      {
                        name: 'feature',
                        remote: false,
                        current: false,
                        upstream: '',
                      },
                    ];
                  case 'default_branch':
                    return 'main';
                  case 'compare_files':
                    return {
                      base: 'b'.repeat(40),
                      target: 't'.repeat(40),
                      files: [
                        {
                          path: 'src/app.ts',
                          status: 'M',
                          additions: 1,
                          deletions: 1,
                        },
                      ],
                    };
                  case 'tree':
                    return payload.args.path
                      ? [
                          {
                            name: 'app.ts',
                            path: 'src/app.ts',
                            directory: false,
                            ignored: false,
                            status: 'M',
                          },
                        ]
                      : [
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
                  case 'diff':
                    return diff;
                  case 'file_lines':
                    return gappedText;
                  case 'diff_stack':
                    return {
                      files: Object.fromEntries(
                        [
                          'src/app.ts',
                          ...status.entries.map((entry) => entry.path),
                        ].map((path) => [path, diff]),
                      ),
                      truncated: false,
                    };
                  case 'refresh':
                  case 'stash_drop':
                    return null;
                  case 'sync':
                    throw {
                      category: 'refused',
                      message:
                        "To github.com:acme/fixture.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'github.com:acme/fixture.git'\nhint: Updates were rejected because the remote contains work that you do\nhint: not have locally.",
                    };
                  case 'branch_switch':
                    throw {
                      category: 'refused',
                      message:
                        'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/app.ts\n\tREADME.md\nPlease commit your changes or stash them before you switch branches.\nAborting',
                    };
                  default:
                    throw new Error(`Unmocked e2e command: ${payload.command}`);
                }
              }
              throw new Error(`Unmocked e2e invocation: ${name}`);
            },
          },
        });
      },
      {
        diff,
        gapped,
        gappedText,
        repository,
        settings: { ...settings, theme: 'system' },
        status,
        stashes,
        update,
      },
    );
    await page.clock.setFixedTime(frozen);
    await use(page);
  },
});
export { expect };
