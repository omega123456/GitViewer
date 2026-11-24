import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Profiler } from 'react';
import App from '../App';
import { Providers } from '../providers';
import { useSelection, selectionOf } from '../stores/selection';
import { calls, mockCommand } from './harness';
import { renders } from './renders';
import { HASH_LENGTH, repository, status } from './fixtures';
import {
  colored,
  mountApp,
  runAction,
  setup,
  waitForWorkersIdle,
} from './workbench';

const CROWDED_FILE_COUNT = 60;
const HELLO_KEYSTROKES = 5;
const SIDEBAR_FIRST_X = 420;
const SIDEBAR_SECOND_X = 460;
const EXPECTED_DRAG_RENDERS = 2;

const heavyChildren = [
  'ChangesSection',
  'FilesSection',
  'StashSection',
  'CommitList',
  'DiffPane',
  'SelectedDiff',
];

const crowdedStatus = {
  ...status,
  entries: [
    ...status.entries,
    ...Array.from({ length: CROWDED_FILE_COUNT }, (_unused, index) => ({
      kind: 'ordinary' as const,
      path: `src/file${index}.ts`,
      index: '.',
      worktree: 'M',
    })),
  ],
};

async function mountIsolatedShell() {
  setup();
  mockCommand('status', () => crowdedStatus);
  let commits = 0;
  render(
    <Profiler id="shell" onRender={() => (commits += 1)}>
      <Providers>
        <App />
      </Providers>
    </Profiler>,
  );
  await screen.findByRole('button', { name: 'All changes' });
  act(() =>
    useSelection
      .getState()
      .select(repository.id, { path: 'src/app.ts', source: 'unstaged' }),
  );
  const pane = await screen.findByRole('region', { name: 'Diff viewer' });
  await waitFor(() => expect(colored(pane)).toBeGreaterThan(0));
  await waitForWorkersIdle();
  renders.start();
  commits = 0;
  return () => commits;
}

it('re-renders only the commit box while typing a message', async () => {
  const user = userEvent.setup();
  const commits = await mountIsolatedShell();
  await user.type(screen.getByLabelText('Commit message'), 'hello');
  expect(commits()).toBeGreaterThanOrEqual(HELLO_KEYSTROKES);
  expect(renders.of('CommitFooter')).toBeGreaterThanOrEqual(HELLO_KEYSTROKES);
  heavyChildren.forEach((name) => expect(renders.of(name), name).toBe(0));
  expect(renders.of('RepositoryView')).toBe(1);
});

it('re-renders none of the heavy children while the sidebar divider moves', async () => {
  const commits = await mountIsolatedShell();
  const divider = screen.getByLabelText('Resize sidebar');
  fireEvent.pointerDown(divider);
  fireEvent.pointerMove(divider, { clientX: SIDEBAR_FIRST_X });
  fireEvent.pointerMove(divider, { clientX: SIDEBAR_SECOND_X });
  expect(divider).toHaveAttribute('aria-valuenow', String(SIDEBAR_SECOND_X));
  expect(commits()).toBeGreaterThanOrEqual(EXPECTED_DRAG_RENDERS);
  expect(renders.of('RepositoryView')).toBe(EXPECTED_DRAG_RENDERS);
  heavyChildren.forEach((name) => expect(renders.of(name), name).toBe(0));
});

it('commits and moves between files with the text typed after the last view render', async () => {
  setup();
  mockCommand('commit', () => 'b'.repeat(HASH_LENGTH));
  const user = userEvent.setup();
  mountApp();
  const box = await screen.findByLabelText('Commit message');
  const control = () => screen.getByRole('button', { name: /^Commit .*main$/ });
  expect(control()).toBeDisabled();
  await user.type(box, '   ');
  expect(control()).toBeDisabled();
  await user.type(box, 'a');
  expect(control()).toBeEnabled();
  renders.start();
  await user.type(box, 'bc');
  expect(renders.of('RepositoryView')).toBe(0);
  await runAction('commit');
  expect(calls).toContainEqual({
    command: 'commit',
    args: { repo: repository.id, message: '   abc' },
  });
  await user.type(screen.getByPlaceholderText('Filter files…'), 'new');
  await runAction('next-file');
  expect(selectionOf(repository.id, 'working')?.path).toBe('new.txt');
});
