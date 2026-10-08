import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect } from 'vitest';
import App from '../App';
import { Providers } from '../providers';
import { QueryProvider } from '../providers/QueryProvider';
import { registeredActions } from '../lib/actions';
import { useTabs } from '../stores/tabs';
import { DiffPane } from '../components/diff/DiffPane';
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { client } from '../lib/query';
import { mockCommand, calls } from './harness';
import { workers } from './setup';
import { settings, status, repository, diff, stack } from './fixtures';
import type { Stack } from '../stores/selection';
export const commit = {
  hash: 'a'.repeat(40),
  parents: ['b'.repeat(40)],
  author: 'Author',
  timestamp: 1700000000,
  subject: 'Review commit',
  refs: 'main',
  lane: 0,
  color: 0,
  entered: false,
  segments: [{ from: 0, to: 0, color: 0 }],
};
export const branches = [
  {
    name: 'main',
    current: true,
    remote: false,
    upstream: 'origin/main',
    gone: false,
  },
  { name: 'feature', current: false, remote: false, upstream: '', gone: false },
  {
    name: 'origin/main',
    current: false,
    remote: true,
    upstream: '',
    gone: false,
  },
];
export function setup() {
  mockCommand('env', () => ({
    found: true,
    supported: true,
    version: '2.50.1',
  }));
  mockCommand('settings_get', () => settings);
  mockCommand('status', () => status);
  mockCommand('tree', () => [
    {
      path: 'src/app.ts',
      name: 'app.ts',
      directory: false,
      ignored: false,
      status: 'M',
    },
  ]);
  mockCommand('stashes', () => []);
  mockCommand('history', () => ({ commits: [commit], cursor: null }));
  mockCommand('commit_files', () => ({
    statuses: { 'src/app.ts': 'M' },
    lines: {},
  }));
  mockCommand('branches', () => branches);
  mockCommand('diff', () => diff);
  mockCommand('diff_stack', () => stack);
  mockCommand('refresh', () => null);
  mockCommand('files_action', () => null);
  mockCommand('sync', () => null);
  mockCommand('stash_save', () => 'stash-hash');
  mockCommand('repo_close', () => null);
  useTabs.getState().open(repository.id, repository.name);
}
export function mount() {
  return render(
    <Providers>
      <App />
    </Providers>,
  );
}
export const settled = () => new Promise((resolve) => setTimeout(resolve, 250));
export const count = (command: string) =>
  calls.filter((call) => call.command === command).length;
export const picture = {
  ...diff,
  path: 'photo.png',
  image: true,
  hunks: [],
  patches: [],
};
export const height = (block: HTMLElement) =>
  within(block)
    .getByText('Loading…')
    .style.getPropertyValue('--virtual-height');
export const shown = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('code')].filter((code) =>
    code.textContent?.includes(text),
  ).length;
export const colored = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.text-syntax')].filter(
    (span) => span.style.getPropertyValue('--syntax-color') !== 'inherit',
  ).length;
export async function renderStack(stack: Stack = 'commit') {
  const view = render(
    <QueryProvider>
      <AllChangesPane
        repo={repository.id}
        stack={stack}
        commit={
          stack === 'commit'
            ? { path: '', source: 'commit', revision: commit.hash }
            : undefined
        }
        status={status}
        settings={settings}
        disabled={false}
      />
    </QueryProvider>,
  );
  const labels: Record<string, string> = {
    commit: 'All changes in commit',
    unstaged: 'All changes',
  };
  const pane = await screen.findByRole('region', { name: labels[stack] });
  return Object.assign(pane, { unmount: view.unmount });
}
export function renderFile(
  selection: Parameters<typeof DiffPane>[0]['selection'],
) {
  return render(
    <QueryProvider>
      <DiffPane
        repo={repository.id}
        selection={selection}
        settings={settings}
        disabled={false}
      />
    </QueryProvider>,
  );
}
export function restart() {
  calls.length = 0;
  client.clear();
}
export async function action(id: string) {
  await act(async () => {
    const entry = registeredActions(repository.id).find(
      (entry) => entry.id === id,
    );
    expect(entry, id).toBeDefined();
    expect(entry?.disabled, id).not.toBe(true);
    await entry?.run();
  });
}
export async function run(repo: string, id: string) {
  await act(async () => {
    const entry = registeredActions(repo).find((entry) => entry.id === id);
    expect(entry, id).toBeDefined();
    await entry?.run();
  });
}
export const repoCalls = (repo: string) =>
  calls
    .filter((call) => (call.args as { repo?: string }).repo === repo)
    .map((call) => call.command);
export function markdownDiff(lines: { kind: string; content: string }[]) {
  return {
    ...diff,
    path: 'README.md',
    content: null,
    hunks: [
      {
        header: `@@ -1,${lines.length} +1,${lines.length} @@`,
        oldStart: 1,
        oldCount: lines.length,
        newStart: 1,
        newCount: lines.length,
        lines: lines.map((line, index) => ({
          kind: line.kind,
          content: line.content,
          old: line.kind === 'add' ? null : index + 1,
          new: line.kind === 'remove' ? null : index + 1,
          noNewline: false,
          marks: [],
        })),
      },
    ],
  };
}
export const blameLines = [
  {
    hash: 'a'.repeat(40),
    author: 'Author',
    timestamp: 1700000000,
    line: 1,
    content: 'first',
    block: true,
  },
];
export const rows = (
  count: number,
  content = (index: number) => `const row${index} = ${index};`,
) => ({
  ...diff,
  hunks: [
    {
      header: `@@ -1,${count} +1,${count} @@`,
      oldStart: 1,
      oldCount: count,
      newStart: 1,
      newCount: count,
      lines: Array.from({ length: count }, (_, index) => ({
        kind: 'context' as const,
        content: content(index),
        old: index + 1,
        new: index + 1,
        noNewline: false,
        marks: [] as [number, number][],
      })),
    },
  ],
});
export const named = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `src/file${String(index).padStart(3, '0')}.ts`,
  );
export const headers = (pane: HTMLElement) =>
  within(pane).queryAllByRole('button', { name: /file\d{3}\.ts/ });
export function scrollTo(pane: HTMLElement, top: number) {
  const scroller = pane.lastElementChild as HTMLDivElement;
  act(() => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  });
}
export const blockOf = (pane: HTMLElement, path: RegExp) =>
  within(pane).getByRole('button', { name: path }).parentElement!
    .parentElement!;
export const jobsFor = (path: string) =>
  workers.jobs.filter((job) => job.path === path).length;
