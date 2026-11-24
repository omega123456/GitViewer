import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { milliseconds } from 'date-fns';
import { scheduleAutoFetch } from '../lib/fetch-schedule';
import { patched, useFormState } from '../lib/form-state';
import {
  expanded,
  fullyOpened,
  toggledFull,
} from '../components/diff/openings';
import {
  highlighted,
  idleHighlight,
  noTokens,
  sameInputs,
} from '../components/diff/highlight-state';
import {
  ACTIONABLE_TOAST_DURATION_MS,
  TOAST_DURATION_MS,
  diffNotices,
  toastDuration,
  toastEntries,
} from '../components/shell/toast-notices';
import {
  emptyCursor,
  moved,
  paged,
  pointedAt,
  searched,
} from '../components/shell/palette-cursor';
import { withViewMode } from '../components/diff/view-mode';
import { clampedTo } from '../components/shell/ResizeHandle';
import type { Gap } from '../components/diff/rows';
import { appScope, type Failure } from '../stores/errors';
import type { Notice } from '../stores/successes';
import { useTabs } from '../stores/tabs';
import { calls, mockCommand } from './harness';
import { diff } from './fixtures';

const AUTO_FETCH_SECONDS = 30;
const TWO_FETCH_CALLS = 2;
const GAP_END_LINE = 40;
const GAP_STEP_LINES = 20;
const MIN_BOUND = 10;
const MAX_BOUND = 20;
const BELOW_MIN = 5;
const ABOVE_MAX = 25;
const INSIDE_BOUND = 15;
const NOTICE_ID_TWO = 2;
const APP_FAILURE_ID = 3;
const STALE_TOAST_ID = 9;
const OVERFLOW_INDEX = 9;
const THREE_ROWS = 3;
const FOUR_ROWS = 4;
const LAST_OF_FOUR = 3;
const PAGE_STEP = 10;
const POINTED_INDEX = 2;

afterEach(() => {
  vi.useRealTimers();
});

describe('auto fetch', () => {
  it('fetches each shown view on the interval without overlapping', async () => {
    vi.useFakeTimers();
    let finish = () => {};
    mockCommand(
      'sync',
      () =>
        new Promise<null>((resolve) => {
          finish = () => resolve(null);
        }),
    );
    useTabs.getState().open('/a', 'A');
    expect(scheduleAutoFetch(null)).toBeUndefined();
    const stop = scheduleAutoFetch({ seconds: AUTO_FETCH_SECONDS });
    vi.advanceTimersByTime(milliseconds({ seconds: AUTO_FETCH_SECONDS }));
    vi.advanceTimersByTime(milliseconds({ seconds: AUTO_FETCH_SECONDS }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    finish();
    await vi.advanceTimersByTimeAsync(
      milliseconds({ seconds: AUTO_FETCH_SECONDS }),
    );
    expect(calls).toHaveLength(TWO_FETCH_CALLS);
    stop?.();
  });
});

describe('form state', () => {
  it('patches and resets a grouped form', () => {
    expect(patched({ name: 'a', open: false }, { open: true })).toEqual({
      name: 'a',
      open: true,
    });
    const initial = { name: '', open: false };
    const { result } = renderHook(() => useFormState(initial));
    act(() => result.current.update({ name: 'feature' }));
    expect(result.current.form).toEqual({ name: 'feature', open: false });
    act(() => result.current.reset());
    expect(result.current.form).toBe(initial);
  });
});

describe('diff view state', () => {
  const gap: Gap = {
    key: 'g',
    kind: 'mid',
    start: 1,
    end: GAP_END_LINE,
    offset: 0,
    hunk: 0,
  };
  it('widens a gap in each direction and toggles the full file', () => {
    expect(expanded({}, { gap: gap, direction: 'down' })).toEqual({
      g: { down: GAP_STEP_LINES, up: 0 },
    });
    expect(
      expanded(
        { g: { down: GAP_STEP_LINES, up: 0 } },
        { gap: gap, direction: 'up' },
      ),
    ).toEqual({ g: { down: GAP_STEP_LINES, up: GAP_STEP_LINES } });
    expect(
      expanded(
        { g: { down: GAP_STEP_LINES, up: 0 } },
        { gap: gap, direction: 'all' },
      ),
    ).toEqual({ g: { down: GAP_STEP_LINES, up: Infinity } });
    expect(fullyOpened([gap])).toEqual({ g: { down: 0, up: Infinity } });
    expect(toggledFull([gap], true)).toEqual({});
    expect(toggledFull([gap], false)).toEqual(fullyOpened([gap]));
  });
  it('compares highlight inputs field by field', () => {
    const inputs = { data: diff, path: 'a', dark: false };
    expect(sameInputs(inputs, { ...inputs })).toBe(true);
    expect(sameInputs(inputs, { ...inputs, dark: true })).toBe(false);
    expect(idleHighlight('a', true)).toEqual({
      inputs: { path: 'a', dark: true },
      done: false,
      tokens: noTokens,
    });
    expect(highlighted(inputs, noTokens, true).done).toBe(true);
  });
  it('switches one view mode on and the others off', () => {
    const selection = { path: 'a.md', source: 'unstaged' as const };
    expect(
      withViewMode({ ...selection, blame: true }, 'rendered', true),
    ).toEqual({
      ...selection,
      rendered: true,
      blame: false,
      editing: false,
    });
  });
  it('clamps a resize value into its bounds', () => {
    const bounds = { min: MIN_BOUND, max: MAX_BOUND, step: 1 };
    expect(clampedTo(bounds, BELOW_MIN)).toBe(MIN_BOUND);
    expect(clampedTo(bounds, ABOVE_MAX)).toBe(MAX_BOUND);
    expect(clampedTo(bounds, INSIDE_BOUND)).toBe(INSIDE_BOUND);
  });
});

describe('toast notices', () => {
  const failure: Failure = {
    id: 1,
    error: { category: 'git', message: 'boom' },
  };
  const notice: Notice = { id: NOTICE_ID_TWO, key: 'done', title: 'Done' };
  it('orders app failures, tab failures and notices by id', () => {
    const entries = toastEntries({
      active: '/r',
      app: [{ ...failure, id: APP_FAILURE_ID }],
      tab: [failure],
      done: [notice],
    });
    expect(entries.map((entry) => [entry.scope, entry.id])).toEqual([
      ['/r', 1],
      ['/r', NOTICE_ID_TWO],
      [appScope, APP_FAILURE_ID],
    ]);
  });
  it('reports which toasts to dismiss and which to publish', () => {
    const entries = toastEntries({
      active: '/r',
      app: [],
      tab: [failure],
      done: [notice],
    });
    const changes = diffNotices([1, STALE_TOAST_ID], entries);
    expect(changes.removed).toEqual([STALE_TOAST_ID]);
    expect(changes.added.map((entry) => entry.id)).toEqual([NOTICE_ID_TWO]);
  });
  it('keeps failures and pending notices until dismissed', () => {
    const scope = '/r';
    expect(toastDuration({ scope: scope, id: 1, failure: failure })).toBe(
      Infinity,
    );
    expect(
      toastDuration({
        scope: scope,
        id: NOTICE_ID_TWO,
        notice: { ...notice, pending: true },
      }),
    ).toBe(Infinity);
    expect(
      toastDuration({
        scope: scope,
        id: NOTICE_ID_TWO,
        notice: { ...notice, show: '/w' },
      }),
    ).toBe(ACTIONABLE_TOAST_DURATION_MS);
    expect(
      toastDuration({ scope: scope, id: NOTICE_ID_TWO, notice: notice }),
    ).toBe(TOAST_DURATION_MS);
  });
});

describe('palette cursor', () => {
  it('resets on search and moves, pages and points within the rows', () => {
    expect(searched('ab')).toEqual({ filter: 'ab', index: 0 });
    const cursor = { filter: 'a', index: OVERFLOW_INDEX };
    expect(moved(cursor, { delta: 1, count: THREE_ROWS }).index).toBe(0);
    expect(moved(cursor, { delta: -1, count: THREE_ROWS }).index).toBe(1);
    expect(moved(cursor, { delta: 1, count: 0 }).index).toBe(0);
    expect(
      paged(emptyCursor, { delta: PAGE_STEP, count: FOUR_ROWS }).index,
    ).toBe(LAST_OF_FOUR);
    expect(paged(cursor, { delta: -PAGE_STEP, count: FOUR_ROWS }).index).toBe(
      0,
    );
    expect(pointedAt(cursor, POINTED_INDEX)).toEqual({
      filter: 'a',
      index: POINTED_INDEX,
    });
  });
});
