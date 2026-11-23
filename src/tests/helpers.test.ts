import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUnixTime, subDays, subMinutes } from 'date-fns';
import { create } from 'zustand';
import { plural, pluralWord, truncateList } from '../lib/text';
import { stepIndex, wrapIndex } from '../lib/list';
import { without, withEntry, withoutAll, withoutWhere } from '../lib/record';
import { elapsedTime, relativeTime } from '../lib/time';
import {
  fetchIntervals,
  intervalLabels,
  updateCheckIntervals,
} from '../lib/intervals';
import { createThenSwitch } from '../lib/create';
import {
  baseBadges,
  baseGroups,
  baseOrHead,
  branchRefs,
  sanitizeBranchName,
} from '../lib/branch-name';
import { isEditableTarget } from '../lib/browser';
import { splitPath } from '../lib/paths';
import { handleKeyByTable, tabKeyHandlers } from '../lib/keyboard';
import { emptyHints } from '../components/shell/palette-groups';
import { confirmAction } from '../lib/dialog';
import { saveSettings } from '../lib/settings';
import { createNoticeStore, nextNotice } from '../stores/notices';
import { repoStateUpdater, type RepoStates } from '../stores/repo-state';
import { countChanges } from '../components/diff/useDiffFile';
import { rowLines } from '../components/sidebar/TreeRow';
import type { Branch, Diff, Lines } from '../lib/types';
import type { Node } from '../components/sidebar/nodes';
import { calls, dialog, mockCommand } from './harness';
import { diff, settings } from './fixtures';

afterEach(() => {
  vi.useRealTimers();
});

describe('text helpers', () => {
  it('pluralises counts and truncates long lists', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(2, 'file')).toBe('2 files');
    expect(plural(2, 'branch', 'branches')).toBe('2 branches');
    expect(pluralWord(1, 'is', 'are')).toBe('is');
    expect(pluralWord(3, 'is', 'are')).toBe('are');
    const layout = { limit: 2, separator: ', ', overflowSeparator: ' ' };
    expect(truncateList(['a', 'b'], layout)).toBe('a, b');
    expect(truncateList(['a', 'b', 'c', 'd'], layout)).toBe('a, b and 2 more');
  });
});

describe('index and record helpers', () => {
  it('wraps indexes in both directions', () => {
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(3, 3)).toBe(0);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });
  it('adds and removes record entries without mutating', () => {
    const record = { one: 1, two: 2, three: 3 };
    expect(withEntry(record, 'four', 4)).toEqual({ ...record, four: 4 });
    expect(without(record, 'one')).toEqual({ two: 2, three: 3 });
    expect(withoutAll(record, ['one', 'two'])).toEqual({ three: 3 });
    expect(withoutWhere(record, (key) => key.startsWith('t'))).toEqual({
      one: 1,
    });
    expect(record).toEqual({ one: 1, two: 2, three: 3 });
  });
});

describe('time and interval helpers', () => {
  it('renders relative and elapsed time', () => {
    vi.useFakeTimers();
    const now = new Date('2026-11-23T12:00:00Z');
    vi.setSystemTime(now);
    expect(relativeTime(getUnixTime(subMinutes(now, 5)))).toBe('5 minutes ago');
    expect(elapsedTime(getUnixTime(subDays(now, 2)))).toBe('2 days');
  });
  it('labels every interval choice', () => {
    expect(intervalLabels(fetchIntervals)).toMatchObject({
      off: 'Off',
      '1m': 'Every minute',
    });
    expect(intervalLabels(updateCheckIntervals)).toMatchObject({
      '1d': 'Every day',
    });
    expect(fetchIntervals.off.every).toBeNull();
    expect(updateCheckIntervals['1h'].every).toEqual({ hours: 1 });
  });
});

describe('create flow', () => {
  it('switches only after a successful create in switch mode', async () => {
    const finish = vi.fn();
    const switchTo = vi.fn(async () => undefined);
    await createThenSwitch({
      mode: 'switch',
      create: async () => 'created',
      finish: finish,
      switchTo: switchTo,
    });
    expect(finish).toHaveBeenCalledOnce();
    expect(switchTo).toHaveBeenCalledWith('created');
    await createThenSwitch({
      mode: 'stay',
      create: async () => 'kept',
      finish: finish,
      switchTo: switchTo,
    });
    expect(switchTo).toHaveBeenCalledOnce();
    await createThenSwitch({
      mode: 'switch',
      create: async () => undefined,
      finish: finish,
      switchTo: switchTo,
    });
    expect(finish).toHaveBeenCalledTimes(2);
  });
});

describe('branch form helpers', () => {
  const branch = (name: string, extra: Partial<Branch> = {}): Branch => ({
    name: name,
    remote: false,
    current: false,
    default: false,
    upstream: '',
    gone: false,
    ...extra,
  });
  it('derives refs, groups and badges for attached and detached heads', () => {
    const refs = branchRefs([
      branch('main', { current: true }),
      branch('feature'),
      branch('origin/main', { remote: true }),
    ]);
    expect(refs).toEqual({
      head: 'main',
      local: ['main', 'feature'],
      remote: ['origin/main'],
    });
    expect(baseGroups(refs)).toEqual([
      { label: 'Local', options: ['main', 'feature'] },
      { label: 'Remote', options: ['origin/main'] },
    ]);
    expect(baseBadges(refs.head)).toEqual({ main: 'current' });
    const detached = branchRefs([branch('feature')]);
    expect(baseGroups(detached)).toEqual([
      { label: 'Local', options: ['HEAD', 'feature'] },
    ]);
    expect(baseBadges(detached.head)).toEqual({ HEAD: 'detached' });
    expect(baseOrHead('', 'main')).toBe('main');
    expect(baseOrHead('', undefined)).toBe('HEAD');
    expect(baseOrHead('feature', 'main')).toBe('feature');
    expect(sanitizeBranchName('new  feature name')).toBe('new-feature-name');
  });
});

describe('browser and path helpers', () => {
  it('recognises editable targets', () => {
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
  it('splits a path into directory and name', () => {
    expect(splitPath('src/lib/paths.ts')).toEqual({
      directory: 'src/lib/',
      name: 'paths.ts',
    });
    expect(splitPath('README.md')).toEqual({
      directory: '',
      name: 'README.md',
    });
  });
});

describe('key tables', () => {
  const press = (key: string) => ({ key: key, preventDefault: vi.fn() });
  it('runs the handler for a listed key and prevents its default', () => {
    const enter = vi.fn();
    const listed = press('Enter');
    handleKeyByTable(listed, { Enter: enter });
    expect(enter).toHaveBeenCalledOnce();
    expect(listed.preventDefault).toHaveBeenCalledOnce();
    const unlisted = press('Escape');
    handleKeyByTable(unlisted, { Enter: enter, Escape: undefined });
    expect(enter).toHaveBeenCalledOnce();
    expect(unlisted.preventDefault).not.toHaveBeenCalled();
  });
  it('steps tab selection with wrap-around and jumps to either end', () => {
    const selected: number[] = [];
    const handlers = tabKeyHandlers(2, 3, (index) => selected.push(index));
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End'])
      handleKeyByTable(press(key), handlers);
    expect(selected).toEqual([0, 1, 0, 2]);
  });
  it('hints at another palette mode only when its shortcut exists', () => {
    const none = { ignored: true, openKey: undefined, fileKey: undefined };
    expect(emptyHints.commands(none)).toBeNull();
    expect(emptyHints.repositories(none)).toBeNull();
    expect(emptyHints.files(none)).toBeNull();
    expect(emptyHints.files({ ...none, ignored: false })).toBe(
      'Include ignored files to widen the search',
    );
  });
});

describe('shared IPC and dialog wrappers', () => {
  it('asks with the shared confirm preset', async () => {
    dialog.approved = false;
    expect(
      await confirmAction('Delete it?', { title: 'Delete', okLabel: 'Go' }),
    ).toBe(false);
    expect(dialog.title).toBe('Delete');
    expect(dialog.message).toBe('Delete it?');
  });
  it('saves settings with a patch applied', async () => {
    mockCommand('settings_set', (next) => next);
    await saveSettings(settings, { zoom: 125 });
    expect(calls.at(-1)).toEqual({
      command: 'settings_set',
      args: { ...settings, zoom: 125 },
    });
  });
});

describe('store factories', () => {
  it('scopes notices and dismisses them by id', () => {
    interface Item {
      id: number;
      text: string;
    }
    const store = createNoticeStore<
      Item,
      {
        add: (scope: string, text: string) => void;
        count: (scope: string) => number;
      }
    >(({ edit, listOf }) => ({
      add: (scope, text) =>
        edit(scope, (list) => [...list, { id: nextNotice(), text: text }]),
      count: (scope) => listOf(scope)?.length ?? 0,
    }));
    store.getState().add('repo', 'first');
    store.getState().add('repo', 'second');
    expect(store.getState().count('repo')).toBe(2);
    expect(store.getState().count('other')).toBe(0);
    const first = store.getState().scopes.repo[0];
    store.getState().dismiss('repo', first.id);
    expect(store.getState().scopes.repo.map((item) => item.text)).toEqual([
      'second',
    ]);
  });
  it('patches per-repo state starting from the idle value', () => {
    interface Run {
      busy: boolean;
      label: string;
    }
    const idle: Run = { busy: false, label: '' };
    const store = create<RepoStates<Run>>(() => ({ repos: {} }));
    const update = repoStateUpdater(store, idle);
    update('repo', { busy: true });
    update('repo', { label: 'done' });
    expect(store.getState().repos.repo).toEqual({ busy: true, label: 'done' });
  });
});

describe('diff and tree helpers', () => {
  it('counts added and removed lines', () => {
    expect(countChanges(undefined)).toEqual({ added: 0, removed: 0 });
    const counted: Diff = diff;
    const lines = counted.hunks.flatMap((hunk) => hunk.lines);
    expect(countChanges(counted)).toEqual({
      added: lines.filter((line) => line.kind === 'add').length,
      removed: lines.filter((line) => line.kind === 'remove').length,
    });
  });
  it('picks the line count shown on a tree row', () => {
    const lines: Record<string, Lines> = { 'src/a.ts': [3, 1] };
    const folders: Record<string, Lines> = { src: [5, 2] };
    const file: Node = {
      path: 'src/a.ts',
      name: 'a.ts',
      directory: false,
      ignored: false,
      status: 'M',
      children: [],
      paths: [],
      partial: false,
    };
    const folder: Node = { ...file, path: 'src', name: 'src', directory: true };
    expect(
      rowLines({
        id: 'src/a.ts',
        node: file,
        expanded: false,
        folders: folders,
        lines: lines,
      }),
    ).toEqual([3, 1]);
    expect(
      rowLines({ id: 'src', node: folder, expanded: false, folders: folders }),
    ).toEqual([5, 2]);
    expect(
      rowLines({ id: 'src', node: folder, expanded: true, folders: folders }),
    ).toBeUndefined();
  });
});
