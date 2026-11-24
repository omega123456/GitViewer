import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { expect } from 'vitest';
import App from '../App';
import { Providers } from '../providers';
import { QueryProvider } from '../providers/QueryProvider';
import { registeredActions } from '../lib/actions';
import { useTabs } from '../stores/tabs';
import { DiffPane } from '../components/diff/DiffPane';
import { AllChangesPane } from '../components/diff/AllChangesPane';
import { client } from '../lib/query';
import type { Diff } from '../lib/types';
import type { Stack } from '../stores/selection';
import { calls, clearCalls, count, mockCommand } from './harness';
import { workers } from './setup';
import {
  COMMIT_TIMESTAMP,
  HASH_LENGTH,
  branchFixture,
  diff,
  envMock,
  repository,
  settings,
  stack,
  status,
} from './fixtures';

const FILE_PAD_WIDTH = 3;

export const commit = {
  hash: 'a'.repeat(HASH_LENGTH),
  parents: ['b'.repeat(HASH_LENGTH)],
  author: 'Author',
  timestamp: COMMIT_TIMESTAMP,
  subject: 'Review commit',
  refs: 'main',
  lane: 0,
  color: 0,
  entered: false,
  segments: [{ from: 0, to: 0, color: 0 }],
};

export const branches = [
  branchFixture('main', {
    current: true,
    default: true,
    upstream: 'origin/main',
  }),
  branchFixture('feature'),
  branchFixture('origin/main', { default: true, remote: true }),
];

export function setup() {
  mockCommand('env', () => envMock);
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
  mockCommand('commit_detail', () => ({
    hash: commit.hash,
    author: commit.author,
    timestamp: commit.timestamp,
    subject: commit.subject,
    body: '',
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

export function mountApp() {
  return render(
    <Providers>
      <App />
    </Providers>,
  );
}

export { count };

export const picture: Diff = {
  ...diff,
  path: 'photo.png',
  image: true,
  hunks: [],
  patches: [],
};

export function assertElement(
  element: Element | null | undefined,
): HTMLElement {
  if (element instanceof HTMLElement) return element;
  throw new Error('Expected an HTML element');
}

export function height(block: HTMLElement) {
  return within(block)
    .getByText('Loading…')
    .style.getPropertyValue('--virtual-height');
}

export function shown(root: HTMLElement, text: string) {
  return [...root.querySelectorAll('code')].filter((code) =>
    code.textContent?.includes(text),
  ).length;
}

export function colored(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('.text-syntax')].filter(
    (span) => span.style.getPropertyValue('--syntax-color') !== 'inherit',
  ).length;
}

export async function waitForWorkersIdle() {
  await waitFor(() => expect(workers.active).toBe(0));
}

export async function waitForQueriesIdle() {
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

export async function renderStack(kind: Stack = 'commit') {
  const view = render(
    <QueryProvider>
      <AllChangesPane
        repo={repository.id}
        stack={kind}
        commit={
          kind === 'commit'
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
  const pane = await screen.findByRole('region', { name: labels[kind] });
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
  clearCalls();
  client.clear();
}

export async function runAction(
  id: string,
  repo = repository.id,
  options?: { allowDisabled?: boolean },
) {
  await act(async () => {
    const entry = registeredActions(repo).find((item) => item.id === id);
    expect(entry, id).toBeDefined();
    if (!options?.allowDisabled) expect(entry?.disabled, id).not.toBe(true);
    await entry?.run();
  });
}

function repoArgOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  if (!('repo' in args)) return undefined;
  return typeof args.repo === 'string' ? args.repo : undefined;
}

export function repoCalls(repo: string) {
  return calls
    .filter((call) => repoArgOf(call.args) === repo)
    .map((call) => call.command);
}

export function markdownDiff(
  lines: { kind: 'context' | 'add' | 'remove'; content: string }[],
): Diff {
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
    hash: 'a'.repeat(HASH_LENGTH),
    author: 'Author',
    timestamp: COMMIT_TIMESTAMP,
    subject: 'Review commit',
    line: 1,
    content: 'first',
    block: true,
  },
];

export function rows(
  lineCount: number,
  content = (index: number) => `const row${index} = ${index};`,
): Diff {
  return {
    ...diff,
    hunks: [
      {
        header: `@@ -1,${lineCount} +1,${lineCount} @@`,
        oldStart: 1,
        oldCount: lineCount,
        newStart: 1,
        newCount: lineCount,
        lines: Array.from({ length: lineCount }, (_unused, index) => ({
          kind: 'context',
          content: content(index),
          old: index + 1,
          new: index + 1,
          noNewline: false,
          marks: [],
        })),
      },
    ],
  };
}

export function named(fileCount: number) {
  return Array.from(
    { length: fileCount },
    (_unused, index) =>
      `src/file${String(index).padStart(FILE_PAD_WIDTH, '0')}.ts`,
  );
}

export function headers(pane: HTMLElement) {
  return within(pane).queryAllByRole('button', { name: /file\d{3}\.ts/ });
}

export function scrollerOf(pane: HTMLElement): HTMLElement {
  return assertElement(pane.lastElementChild);
}

export function scrollTo(pane: HTMLElement, top: number) {
  const scroller = scrollerOf(pane);
  act(() => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  });
}

export function blockOf(pane: HTMLElement, path: RegExp): HTMLElement {
  const button = within(pane).getByRole('button', { name: path });
  return assertElement(button.parentElement?.parentElement);
}

export async function findEditorView(): Promise<EditorView> {
  const host = await screen.findByLabelText('Editor');
  await waitFor(() => expect(host.querySelector('.cm-editor')).not.toBeNull());
  const element = host.querySelector<HTMLElement>('.cm-editor');
  const view = element ? EditorView.findFromDOM(element) : null;
  if (!view) throw new Error('Missing CodeMirror editor view');
  return view;
}

export function jobsFor(path: string) {
  return workers.jobs.filter((job) => job.path === path).length;
}
