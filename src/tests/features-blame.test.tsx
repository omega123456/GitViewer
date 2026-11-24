import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format, formatDistanceToNowStrict, fromUnixTime } from 'date-fns';
import { expect, it, vi } from 'vitest';
import { useLayout } from '../stores/layout';
import { useSelection, selectionOf } from '../stores/selection';
import { initials } from '../components/shared/Avatar';
import { DEFAULT_MAX_FILE_TABS } from '../lib/settings';
import { calls, mockCommand } from './harness';
import { domRect, VIEWPORT_HEIGHT } from './setup';
import { HASH_LENGTH, repository } from './fixtures';
import {
  assertElement,
  blameLines,
  commit,
  mountApp,
  runAction,
  setup,
} from './workbench';

const SECOND_LINE = 2;
const BLAME_WIDTH_AFTER_STEP = 490;
const BLAME_CONTAINER_LEFT = 100;
const BLAME_CONTAINER_WIDE = 1000;
const BLAME_CONTAINER_NARROW = 750;
const BLAME_DRAG_MID_X = 650;
const BLAME_DRAG_MID_WIDTH = 550;
const BLAME_DRAG_MAX_X = 1000;
const BLAME_MAX_WIDTH = 640;
const BLAME_DRAG_MIN_X = 200;
const BLAME_MIN_WIDTH = 360;
const BLAME_DRAG_NARROW_X = 800;
const BLAME_NARROW_CLAMPED = 430;
const HISTORY_PAGE_SIZE = 60;
const HEX_RADIX = 16;
const HISTORY_ROW_HEIGHT = 44;
const TALL_SCROLL_HEIGHT = 100000;

function mockTwoLineBlame() {
  mockCommand('blame', () => [
    blameLines[0],
    {
      ...blameLines[0],
      line: SECOND_LINE,
      content: 'second',
      block: false,
    },
  ]);
}

async function openBlameView() {
  setup();
  mockTwoLineBlame();
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'src/app.ts', source: 'unstaged' },
      DEFAULT_MAX_FILE_TABS,
    );
  mountApp();
  await screen.findByTitle('Stage hunk');
  await runAction('blame');
  expect(await screen.findByText('first')).toBeVisible();
}

function setupPagedBlameHistory() {
  setup();
  const first = Array.from({ length: HISTORY_PAGE_SIZE }, (_unused, index) => ({
    ...commit,
    hash: index.toString(HEX_RADIX).padStart(HASH_LENGTH, '0'),
    subject: `Commit ${index}`,
    refs: '',
  }));
  const older = {
    ...commit,
    hash: 'c'.repeat(HASH_LENGTH),
    subject: 'Older commit',
  };
  const lastHash = first[HISTORY_PAGE_SIZE - 1].hash;
  mockCommand('history', ({ cursor }) =>
    cursor
      ? {
          commits: [older, { ...older, hash: 'd'.repeat(HASH_LENGTH) }],
          cursor: null,
        }
      : { commits: first, cursor: lastHash },
  );
  mockCommand('blame', () => [
    {
      hash: older.hash,
      author: 'Author',
      timestamp: older.timestamp,
      subject: 'Older commit',
      line: 1,
      content: 'first',
      block: true,
    },
  ]);
  return lastHash;
}

it('shows blame annotations and opens blamed commits in history', async () => {
  await openBlameView();
  const user = userEvent.setup();
  const blame = screen.getByLabelText('Blame lines');
  expect(within(blame).getAllByText('Author')).toHaveLength(1);
  expect(within(blame).queryByText(initials('Author'))).toBeNull();
  expect(within(blame).getByTitle('Review commit')).toHaveTextContent(
    'Review commit',
  );
  expect(
    within(blame).getByTitle(format(fromUnixTime(commit.timestamp), 'PPpp')),
  ).toHaveTextContent(
    formatDistanceToNowStrict(fromUnixTime(commit.timestamp), {
      addSuffix: true,
    }),
  );
  await user.click(screen.getByRole('button', { name: 'aaaaaaa' }));
  expect(selectionOf(repository.id, 'history')?.source).toBe('commit');
  expect(
    (
      await within(await screen.findByLabelText('Commit history')).findByText(
        'Review commit',
      )
    ).closest('button'),
  ).toHaveClass('bg-selected');
});

it('resizes blame annotations within container bounds', async () => {
  await openBlameView();
  const annotations = screen.getByRole('slider', {
    name: 'Resize blame annotations',
  });
  fireEvent.keyDown(annotations, { key: 'ArrowRight' });
  expect(useLayout.getState().tabs[repository.id].blameWidth).toBe(
    BLAME_WIDTH_AFTER_STEP,
  );
  const container = assertElement(annotations.parentElement);
  expect(container.style.getPropertyValue('--blame-width')).toBe('490px');
  const rectSpy = vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
    domRect({
      x: BLAME_CONTAINER_LEFT,
      width: BLAME_CONTAINER_WIDE,
      height: VIEWPORT_HEIGHT,
    }),
  );
  fireEvent.pointerDown(annotations);
  fireEvent.pointerMove(annotations, { clientX: BLAME_DRAG_MID_X });
  expect(useLayout.getState().tabs[repository.id].blameWidth).toBe(
    BLAME_DRAG_MID_WIDTH,
  );
  fireEvent.pointerMove(annotations, { clientX: BLAME_DRAG_MAX_X });
  expect(useLayout.getState().tabs[repository.id].blameWidth).toBe(
    BLAME_MAX_WIDTH,
  );
  fireEvent.pointerMove(annotations, { clientX: BLAME_DRAG_MIN_X });
  expect(useLayout.getState().tabs[repository.id].blameWidth).toBe(
    BLAME_MIN_WIDTH,
  );
  rectSpy.mockReturnValue(
    domRect({
      x: BLAME_CONTAINER_LEFT,
      width: BLAME_CONTAINER_NARROW,
      height: VIEWPORT_HEIGHT,
    }),
  );
  fireEvent.pointerMove(annotations, { clientX: BLAME_DRAG_NARROW_X });
  expect(useLayout.getState().tabs[repository.id].blameWidth).toBe(
    BLAME_NARROW_CLAMPED,
  );
});

it('pages the history until a blamed commit is loaded, then selects and reveals it', async () => {
  const lastHash = setupPagedBlameHistory();
  useSelection
    .getState()
    .select(
      repository.id,
      { path: 'src/app.ts', source: 'unstaged', blame: true },
      DEFAULT_MAX_FILE_TABS,
    );
  const user = userEvent.setup();
  mountApp();
  const scroll = vi.mocked(HTMLElement.prototype.scrollTo);
  const tall = vi
    .spyOn(Element.prototype, 'scrollHeight', 'get')
    .mockReturnValue(TALL_SCROLL_HEIGHT);
  const visible = vi
    .spyOn(Element.prototype, 'clientHeight', 'get')
    .mockReturnValue(VIEWPORT_HEIGHT);
  const hash = await screen.findByRole('button', { name: 'ccccccc' });
  scroll.mockClear();
  await user.click(hash);
  await waitFor(() =>
    expect(calls).toContainEqual({
      command: 'history',
      args: { repo: repository.id, path: '', cursor: lastHash },
    }),
  );
  const expectedTop =
    HISTORY_PAGE_SIZE * HISTORY_ROW_HEIGHT +
    HISTORY_ROW_HEIGHT -
    VIEWPORT_HEIGHT;
  await waitFor(() =>
    expect(scroll).toHaveBeenCalledWith(
      expect.objectContaining({ top: expectedTop }),
    ),
  );
  tall.mockRestore();
  visible.mockRestore();
});
