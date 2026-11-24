import { milliseconds } from 'date-fns';
import { expect, it, vi } from 'vitest';
import { handleEvent } from '../lib/query';
import { matches, shortcutLabel } from '../lib/keyboard';
import { markedTokens } from '../lib/highlight';
import { findMatches } from '../components/diff/find';
import { describeActivity, parseProgress } from '../lib/activity';
import { track, useActivity, type Activity } from '../stores/activity';
import type { Commands } from '../lib/types';
import { host, pendingActivity } from './harness';
import { status } from './fixtures';

const MARK_THREE = 3;
const MARK_FOUR = 4;
const MARK_SIX = 6;
const MARK_SEVEN = 7;
const MARK_EIGHT = 8;
const MARK_NINE = 9;
const MARK_TEN = 10;
const MARK_TWO = 2;
const MARK_FOURTEEN = 14;
const COUNTING_PERCENT = 40;
const COMPRESSING_PERCENT = 100;
const RECEIVING_PERCENT = 45;
const BEFORE_REVEAL_SECONDS = 0.299;
const REVEAL_DELAY_SECONDS = 0.3;
const PARTIAL_HOLD_SECONDS = 0.1;

function activityLabel<CommandKey extends keyof Commands>(
  command: CommandKey,
  args: Partial<Commands[CommandKey]['args']>,
  from = status,
) {
  return describeActivity(
    {
      id: 0,
      command: command,
      args: args,
      visible: true,
      held: false,
      done: false,
    } satisfies Activity,
    from,
  );
}

it('uses the host modifier for both labels and dispatch', () => {
  expect(shortcutLabel('Mod+o')).toBe('⌘+o');
  expect(
    matches(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }), 'Mod+o'),
  ).toBe(false);
  expect(shortcutLabel('Ctrl+Shift+Tab')).toBe('⌃+⇧+⇥');
  expect(
    matches(
      new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }),
      'Ctrl+Tab',
    ),
  ).toBe(true);
  expect(
    matches(
      new KeyboardEvent('keydown', { key: 'Tab', metaKey: true }),
      'Ctrl+Tab',
    ),
  ).toBe(false);
  host.platform = 'windows';
  expect(shortcutLabel('Ctrl+Tab')).toBe('Ctrl+⇥');
  expect(
    matches(
      new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }),
      'Ctrl+Tab',
    ),
  ).toBe(true);
  expect(shortcutLabel('Mod+o')).toBe('Ctrl+o');
  expect(
    matches(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }), 'Mod+o'),
  ).toBe(true);
  expect(
    matches(new KeyboardEvent('keydown', { key: 'o', metaKey: true }), 'Mod+o'),
  ).toBe(false);
});

it('keeps the flags of earlier passes when marking tokens again', () => {
  expect(
    markedTokens(
      markedTokens([{ content: 'abc', color: 'red' }], [[0, 1]]),
      [[1, MARK_THREE]],
      'found',
    ),
  ).toEqual([
    { content: 'a', color: 'red', changed: true, found: false },
    { content: 'bc', color: 'red', changed: false, found: true },
  ]);
});

it('finds every case-insensitive literal match with its offsets', () => {
  expect(findMatches(['Foo foo', 'bar', 'a.b(c a.b('], 'FOO')).toEqual([
    { index: 0, start: 0, end: MARK_THREE },
    { index: 0, start: MARK_FOUR, end: MARK_SEVEN },
  ]);
  expect(findMatches(['a.b(c a.b(', 'axb('], 'a.b(')).toEqual([
    { index: 0, start: 0, end: MARK_FOUR },
    { index: 0, start: MARK_SIX, end: MARK_TEN },
  ]);
  expect(findMatches(['anything'], '')).toEqual([]);
});

it('keeps syntax color while splitting a word mark across token boundaries', () => {
  expect(
    markedTokens(
      [
        { content: 'const ', color: 'red' },
        { content: 'value', color: 'blue' },
      ],
      [[0, MARK_EIGHT]],
    ),
  ).toEqual([
    { content: 'const ', color: 'red', changed: true },
    { content: 'va', color: 'blue', changed: true },
    { content: 'lue', color: 'blue', changed: false },
  ]);
});

it('splits tokens at UTF-16 range boundaries around astral and multi-byte characters', () => {
  const line = 'h\u00e9llo \u{1f389} w\u00f6rld';
  const tokens = [
    { content: 'h\u00e9llo ', color: 'a' },
    { content: '\u{1f389} w', color: 'b' },
    { content: '\u00f6rld' },
  ];
  const marked = markedTokens(tokens, [
    [1, MARK_TWO],
    [MARK_SIX, MARK_EIGHT],
    [MARK_NINE, MARK_FOURTEEN],
  ]);
  expect(marked.map((token) => token.content).join('')).toBe(line);
  expect(marked).toEqual([
    { content: 'h', color: 'a', changed: false },
    { content: '\u00e9', color: 'a', changed: true },
    { content: 'llo ', color: 'a', changed: false },
    { content: '\u{1f389}', color: 'b', changed: true },
    { content: ' ', color: 'b', changed: false },
    { content: 'w', color: 'b', changed: true },
    { content: '\u00f6rld', color: undefined, changed: true },
  ]);
  expect(markedTokens([{ content: 'plain' }], [])).toEqual([
    { content: 'plain', color: undefined, changed: false },
  ]);
  expect(markedTokens([{ content: '' }], [[0, 0]])).toEqual([]);
  expect(
    markedTokens(
      [{ content: 'abc' }],
      [
        [0, 1],
        [1, MARK_THREE],
      ],
    ),
  ).toEqual([
    { content: 'a', color: undefined, changed: true },
    { content: 'bc', color: undefined, changed: true },
  ]);
});

it('reads each git progress phase and ignores other lines', () => {
  expect(parseProgress('Enumerating objects: 5, done.')).toEqual({
    phase: 'Preparing',
    percent: undefined,
  });
  expect(parseProgress('remote: Counting objects:  40% (2/5)')).toEqual({
    phase: 'Counting',
    percent: COUNTING_PERCENT,
  });
  expect(parseProgress('Compressing objects: 100% (3/3), done.')).toEqual({
    phase: 'Compressing',
    percent: COMPRESSING_PERCENT,
  });
  expect(parseProgress('Writing objects:  62% (5/8)')?.phase).toBe('Sending');
  expect(parseProgress('Receiving objects:  45% (9/20)')?.percent).toBe(
    RECEIVING_PERCENT,
  );
  expect(parseProgress('Resolving deltas:   7% (1/14)')?.phase).toBe(
    'Finalizing',
  );
  expect(parseProgress('To github.com:owner/repo.git')).toBeNull();
});

it('labels every tracked command in plain words', () => {
  expect(activityLabel('sync', { action: 'fetch' })).toBe('Fetching');
  expect(activityLabel('sync', { action: 'pull' })).toBe(
    'Pulling from origin/main',
  );
  expect(activityLabel('sync', { action: 'push' })).toBe(
    'Pushing to origin/main',
  );
  expect(
    activityLabel('sync', { action: 'push' }, { ...status, upstream: null }),
  ).toBe('Pushing to main');
  expect(activityLabel('commit', {})).toBe('Committing…');
  expect(activityLabel('stash_save', {})).toBe('Stashing…');
  expect(activityLabel('stash_apply', { pop: false })).toBe('Applying stash…');
  expect(activityLabel('stash_apply', { pop: true })).toBe('Popping stash…');
  expect(activityLabel('stash_drop', {})).toBe('Dropping stash…');
  expect(activityLabel('branch_switch', { name: 'main' })).toBe(
    'Switching to main…',
  );
  expect(activityLabel('smart_checkout', { name: 'dev' })).toBe(
    'Switching to dev…',
  );
  expect(activityLabel('branch_create', { name: 'dev' })).toBe('Creating dev…');
  expect(activityLabel('branch_delete', { name: 'dev' })).toBe('Deleting dev…');
  expect(activityLabel('branch_gone', {})).toBe('Checking remote…');
  expect(activityLabel('branch_prune', {})).toBe('Pruning branches…');
  expect(activityLabel('worktree_apply', { smart: false })).toBe(
    'Applying to main…',
  );
  expect(activityLabel('worktree_apply', { smart: true })).toBe(
    'Stashing and applying…',
  );
  expect(activityLabel('worktree_unapply', {})).toBe('Undoing apply…');
  expect(activityLabel('worktree_remove', { worktree: '/wt/spike' })).toBe(
    'Deleting worktree spike…',
  );
  expect(activityLabel('branch_merge', { name: 'dev' })).toBe('Merging dev…');
  expect(activityLabel('merge_abort', {})).toBe('Aborting merge…');
  expect(activityLabel('files_action', { action: 'unstage' })).toBe(
    'Unstaging…',
  );
  expect(activityLabel('hunk_action', { action: 'discard' })).toBe(
    'Discarding…',
  );
  expect(activityLabel('hunk_action', { action: 'other' })).toBeNull();
  expect(activityLabel('refresh', {})).toBeNull();
});

it('reveals slow commands after a delay and holds them briefly', () => {
  vi.useFakeTimers();
  const scope = () => useActivity.getState().scopes.repo ?? [];
  const quick = track('repo', 'commit', { repo: 'repo', message: 'm' });
  vi.advanceTimersByTime(milliseconds({ seconds: BEFORE_REVEAL_SECONDS }));
  expect(scope()).toMatchObject([{ visible: false, done: false }]);
  quick();
  vi.advanceTimersByTime(milliseconds({ seconds: 1 }));
  expect(scope()).toEqual([]);
  const slow = track('repo', 'sync', { repo: 'repo', action: 'pull' });
  vi.advanceTimersByTime(milliseconds({ seconds: REVEAL_DELAY_SECONDS }));
  handleEvent('sync://progress', {
    repo: 'repo',
    message: 'Receiving objects:  45% (9/20)',
    done: false,
  });
  handleEvent('sync://progress', {
    repo: 'repo',
    message: 'From github.com:owner/repo',
    done: false,
  });
  expect(scope()).toMatchObject([
    { visible: true, phase: 'Receiving', percent: RECEIVING_PERCENT },
  ]);
  vi.advanceTimersByTime(milliseconds({ seconds: PARTIAL_HOLD_SECONDS }));
  slow();
  expect(scope()).toMatchObject([{ visible: true, done: true }]);
  vi.advanceTimersByTime(milliseconds({ seconds: REVEAL_DELAY_SECONDS }));
  expect(scope()).toEqual([]);
  const long = track('repo', 'stash_save', { repo: 'repo', message: 'm' });
  vi.advanceTimersByTime(milliseconds({ seconds: 1 }));
  long();
  expect(pendingActivity()).toEqual([]);
});
