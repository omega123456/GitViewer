import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import { invoke, normalizeError } from '../lib/ipc';
import {
  client,
  connectEvents,
  handleEvent,
  perform,
  queryKey,
  useBackend,
} from '../lib/query';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { useFilterStore } from '../stores/filter';
import { useDiffView } from '../stores/diff-view';
import { useImageViews } from '../stores/image-view';
import { usePalette } from '../stores/palette';
import { useTheme } from '../stores/theme';
import { useDensity } from '../stores/density';
import { matches, runShortcut } from '../lib/keyboard';
import { highlight, terminate, tokenize } from '../lib/highlight';
import { highlightWorker, type Reply } from '../lib/highlight.worker';
import { workers } from './setup';
import { fuzzyFilter, fuzzyScore } from '../lib/fuzzy';
import { diffRows, gaps } from '../components/diff/rows';
import { fileCategory, folderGlyph, type FileCategory } from '../lib/file-type';
import {
  changeNodes,
  sourceFor,
  statusClass,
  treeOrder,
  treeRoot,
} from '../components/sidebar/nodes';
import { imageUrl } from '../components/image/url';
import {
  calls,
  emit,
  lastError,
  mockCommand,
  pendingActivity,
} from './harness';
import { describeActivity, parseProgress } from '../lib/activity';
import { track, useActivity, type Activity } from '../stores/activity';
import type { Commands } from '../lib/types';
import { describe as describeFailure, overwrittenPaths } from '../lib/failure';
import { useErrors } from '../stores/errors';
import { describeSuccess, type Before } from '../lib/success';
import { useSuccesses } from '../stores/successes';
import { answer, ask, useDecision } from '../stores/decision';
import { diff, gapped, gappedText, status } from './fixtures';
describe('IPC and events', () => {
  it('rejects unmocked commands honestly', async () => {
    await expect(invoke('env', {})).rejects.toMatchObject({
      message: 'Unmocked IPC command: env',
    });
  });
  it('normalizes all error shapes and performs writes', async () => {
    expect(normalizeError('problem')).toEqual({
      category: 'unexpected',
      message: 'problem',
    });
    expect(normalizeError(new Error('problem')).message).toBe('problem');
    mockCommand('refresh', () => null);
    expect(await perform('refresh', { repo: 'r' })).toBeNull();
    mockCommand('refresh', () => {
      throw { category: 'refused', message: 'No' };
    });
    expect(await perform('refresh', { repo: 'r' })).toBeUndefined();
    expect(pendingActivity()).toEqual([]);
    expect(lastError('r')?.category).toBe('refused');
    expect(lastError('app')).toBeUndefined();
    mockCommand('update_check', () => {
      throw { category: 'network', message: 'Offline' };
    });
    await perform('update_check', {});
    expect(lastError('app')?.category).toBe('network');
    mockCommand('refresh', () => null);
    await useErrors.getState().scopes.r[0].retry?.();
    expect(useErrors.getState().scopes.r).toEqual([]);
  });
  it('keeps the newest three failures per scope and relabels by command', () => {
    const { report, dismiss, resolve, relabel } = useErrors.getState();
    for (const message of ['one', 'two', 'three', 'four'])
      report('r', { category: 'refused', message }, { command: message });
    const messages = () =>
      useErrors.getState().scopes.r.map((failure) => failure.error.message);
    expect(messages()).toEqual(['two', 'three', 'four']);
    const before = useErrors.getState().scopes;
    resolve('r', 'absent');
    expect(useErrors.getState().scopes).toBe(before);
    resolve('r', 'two');
    expect(messages()).toEqual(['three', 'four']);
    relabel('r', 'four', { title: 'Push failed' });
    expect(
      useErrors.getState().scopes.r.map((failure) => failure.title),
    ).toEqual([undefined, 'Push failed']);
    dismiss('r', useErrors.getState().scopes.r[0].id);
    expect(messages()).toEqual(['four']);
  });
  it('describes failures with plain headlines and recoveries', () => {
    expect(
      describeFailure({
        category: 'refused',
        message:
          "To origin\n ! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'origin'",
      }),
    ).toMatchObject({ title: 'Push rejected', recovery: 'pull' });
    expect(
      describeFailure({
        category: 'network',
        message: "fatal: unable to access 'x': Could not resolve host",
      }),
    ).toEqual({
      title: 'Could not reach the remote',
      summary: "Unable to access 'x': Could not resolve host",
      kind: 'network',
      recovery: 'retry',
    });
    expect(
      describeFailure({ category: 'authentication', message: 'denied' }),
    ).toMatchObject({
      title: 'Sign-in to the remote failed',
      kind: 'authentication',
    });
    expect(
      describeFailure({ category: 'unexpected', message: '' }),
    ).toMatchObject({
      title: 'Something went wrong',
      summary: '',
      kind: 'alert',
      recovery: null,
    });
    expect(
      overwrittenPaths(
        'error: Your local changes would be overwritten by checkout:\n\tsrc/app.ts\n\tREADME.md\nAborting',
      ),
    ).toEqual(['src/app.ts', 'README.md']);
  });
  it('replaces an unanswered decision with the newest question', async () => {
    const decision = {
      slot: 'branch',
      title: 'T',
      body: 'B',
      confirm: 'Go',
    } as const;
    const first = ask('r', decision);
    const second = ask('r', decision);
    expect(await first).toBe(false);
    answer('r', true);
    expect(await second).toBe(true);
    answer('r', true);
    expect(useDecision.getState().pending).toEqual({});
  });
  it('invalidates only the event repository and preferences', async () => {
    client.setQueryData(['one', 'status'], status);
    client.setQueryData(['two', 'status'], status);
    client.setQueryData(['one', 'history'], { pages: [] });
    client.setQueryData(['app', 'settings_get'], {});
    const stop = await connectEvents();
    emit('repo://status-changed', { repo: 'one' });
    expect(client.getQueryState(['one', 'status'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['two', 'status'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['one', 'history'])?.isInvalidated).toBe(false);
    emit('repo://head-changed', { repo: 'one' });
    expect(client.getQueryState(['one', 'history'])?.isInvalidated).toBe(true);
    emit('settings://changed', null);
    expect(client.getQueryState(['app', 'settings_get'])?.isInvalidated).toBe(
      true,
    );
    emit('sync://progress', {
      repo: 'two',
      message: 'fetching',
      done: false,
    });
    expect(client.getQueryState(['two', 'status'])?.isInvalidated).toBe(false);
    emit('repo://closed', { repo: 'one' });
    expect(client.getQueryState(['one', 'status'])).toBeUndefined();
    expect(client.getQueryState(['two', 'status'])).toBeDefined();
    stop();
    expect(queryKey('env', {})).toEqual(['app', 'env', {}]);
  });
  it('leaves reference-only queries alone on working-tree events', async () => {
    const references = [
      queryKey('stashes', { repo: 'one' }),
      queryKey('branches', { repo: 'one' }),
      queryKey('blame', { repo: 'one', path: 'a' }),
      queryKey('merge_preview', { repo: 'one', name: 'feature' }),
      queryKey('default_branch', { repo: 'one' }),
      queryKey('commit_files', { repo: 'one', revision: 'a' }),
    ];
    for (const key of references) client.setQueryData(key, []);
    client.setQueryData(queryKey('status', { repo: 'one' }), status);
    const stop = await connectEvents();
    emit('repo://status-changed', { repo: 'one' });
    for (const key of references)
      expect(client.getQueryState(key)?.isInvalidated, String(key[1])).toBe(
        false,
      );
    expect(
      client.getQueryState(queryKey('status', { repo: 'one' }))?.isInvalidated,
    ).toBe(true);
    emit('repo://head-changed', { repo: 'one' });
    for (const key of references)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    stop();
  });
  it('does not refetch mounted reference-only queries on a status change', async () => {
    mockCommand('stashes', () => []);
    mockCommand('branches', () => []);
    mockCommand('blame', () => []);
    mockCommand('merge_preview', () => ({
      outcome: 'upToDate',
      changed: 0,
      conflicts: [],
    }));
    mockCommand('status', () => status);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(
      () => [
        useBackend('stashes', { repo: 'one' }),
        useBackend('branches', { repo: 'one' }),
        useBackend('blame', { repo: 'one', path: 'a' }),
        useBackend('merge_preview', { repo: 'one', name: 'feature' }),
        useBackend('status', { repo: 'one' }),
      ],
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.every((query) => query.isSuccess)).toBe(true),
    );
    const stop = await connectEvents();
    calls.length = 0;
    act(() => emit('repo://status-changed', { repo: 'one' }));
    await waitFor(() =>
      expect(calls.map(({ command }) => command)).toEqual(['status']),
    );
    stop();
  });
  it('reloads only the first history page on a head change and keeps the list meanwhile', async () => {
    const page = (cursor: string) => ({
      commits: [{ hash: `after-${cursor || 'start'}` }],
      cursor: cursor === 'two' ? null : cursor ? 'two' : 'one',
    });
    let release = () => {};
    let hold = false;
    mockCommand('history', ({ cursor }) =>
      hold
        ? new Promise((resolve) => {
            release = () => resolve(page(cursor ?? '') as never);
          })
        : (page(cursor ?? '') as never),
    );
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    client.setQueryData(['one', 'history', ''], {
      pages: [page(''), page('one'), page('two')],
      pageParams: ['', 'one', 'two'],
    });
    const { result } = renderHook(
      () =>
        useInfiniteQuery({
          queryKey: ['one', 'history', ''],
          initialPageParam: '',
          queryFn: ({ pageParam }) =>
            invoke('history', { repo: 'one', path: '', cursor: pageParam }),
          getNextPageParam: (last) => last.cursor ?? undefined,
        }),
      { wrapper },
    );
    expect(result.current.data?.pages).toHaveLength(3);
    expect(calls).toHaveLength(0);
    const stop = await connectEvents();
    calls.length = 0;
    hold = true;
    act(() => emit('repo://head-changed', { repo: 'one' }));
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.data?.pageParams).toEqual(['']);
    expect(result.current.data?.pages[0].commits).toHaveLength(1);
    expect(calls).toEqual([
      { command: 'history', args: { repo: 'one', path: '', cursor: '' } },
    ]);
    await act(async () => release());
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(calls).toHaveLength(1);
    stop();
  });
  it('refreshes only file listings when ignored files change', async () => {
    const listings = [
      queryKey('files', { repo: 'one', ignored: true }),
      queryKey('tree', { repo: 'one', path: '' }),
    ];
    const others = [
      queryKey('status', { repo: 'one' }),
      queryKey('stashes', { repo: 'one' }),
      queryKey('diff', { repo: 'one', path: 'a', source: 'unstaged' }),
      queryKey('tree', { repo: 'two', path: '' }),
    ];
    for (const key of [...listings, ...others]) client.setQueryData(key, []);
    const stop = await connectEvents();
    emit('repo://files-changed', { repo: 'one' });
    for (const key of listings)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of others)
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    stop();
  });
  it('keeps commit, stash and compare diffs valid on working-tree events', async () => {
    const sources = [
      'unstaged',
      'staged',
      'commit',
      'stash',
      'compare',
    ] as const;
    const keys = sources.flatMap((source) => [
      { source, key: queryKey('diff', { repo: 'one', path: 'a', source }) },
      { source, key: queryKey('diff_stack', { repo: 'one', source }) },
    ]);
    for (const { key } of keys) client.setQueryData(key, diff);
    const stop = await connectEvents();
    emit('repo://status-changed', { repo: 'one' });
    for (const { source, key } of keys)
      expect(client.getQueryState(key)?.isInvalidated, source).toBe(
        source === 'unstaged' || source === 'staged',
      );
    emit('repo://head-changed', { repo: 'one' });
    for (const { key } of keys)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    stop();
  });
  it('starts a backend read from initial data without fetching', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(
      () =>
        useBackend('status', { repo: 'one' }, true, {
          data: status,
          updatedAt: 42,
        }),
      { wrapper },
    );
    expect(result.current.data).toBe(status);
    expect(result.current.dataUpdatedAt).toBe(42);
    expect(calls).toHaveLength(0);
  });
});
describe('presentation state', () => {
  it('preserves independent repository selections and messages', () => {
    const tabs = useTabs.getState();
    tabs.open('one', 'One');
    tabs.open('two', 'Two');
    tabs.open('one', 'One');
    tabs.setMessage('one', 'draft');
    useSelection.getState().select('one', { path: 'a', source: 'staged' });
    useLayout.getState().update('one', { mode: 'history' });
    useSelection.getState().select('one', { path: 'b', source: 'commit' });
    expect(useSelection.getState().working.one?.path).toBe('a');
    expect(useSelection.getState().history.one?.path).toBe('b');
    expect(useTabs.getState().tabs[1].message).toBe('');
    tabs.activate('two');
    tabs.close('one');
    expect(useTabs.getState().active).toBe('two');
    tabs.close('two');
    expect(useTabs.getState().active).toBe('');
  });
  it('keeps every presentation slice separately addressable per repository', () => {
    useLayout.getState().update('one', { width: 320, filesHeight: 55 });
    useLayout.getState().update('two', { historyWidth: 500 });
    expect(useLayout.getState().tabs.one.filesHeight).toBe(55);
    expect(useLayout.getState().tabs.two.width).toBe(300);
    useLayout.getState().forget('one');
    expect(useLayout.getState().tabs.one).toBeUndefined();
    useSelection.getState().setPath('one', 'src/app.ts');
    useSelection.getState().select('one', { path: 'a', source: 'staged' });
    useSelection.getState().forget('one');
    expect(useSelection.getState().paths.one).toBe('');
    expect(useSelection.getState().working.one).toBeUndefined();
    useFilterStore.getState().set('one', 'app');
    expect(useFilterStore.getState().text.one).toBe('app');
    useFilterStore.getState().forget('one');
    expect(useFilterStore.getState().text.one).toBeUndefined();
    useImageViews.getState().update('one', { mode: 'swipe', position: 70 });
    expect(useImageViews.getState().tabs.one.blend).toBe(50);
    useImageViews.getState().forget('one');
    expect(useImageViews.getState().tabs.one).toBeUndefined();
    useDiffView.getState().setMode('unified');
    expect(useDiffView.getState().mode).toBe('unified');
    usePalette.getState().setOpen(true);
    usePalette.getState().setSettings(true);
    expect(usePalette.getState().open).toBe(true);
    expect(usePalette.getState().settings).toBe(true);
    useTheme.getState().setPreference('dark');
    useTheme.getState().setSystem(true);
    expect(useTheme.getState().preference).toBe('dark');
    useDensity.getState().setDensity('compact');
    expect(useDensity.getState().density).toBe('compact');
  });
  it('builds both changes trees and partial directory checkboxes', () => {
    expect(changeNodes(status.entries, 'staged', '')['src'].partial).toBe(true);
    expect(
      changeNodes(status.entries, 'unstaged', '')[treeRoot].children,
    ).toEqual(['src', 'new.txt']);
    expect(
      changeNodes(status.entries, 'staged', 'none')[treeRoot].children,
    ).toEqual([]);
    expect(sourceFor(status.entries[0])).toBe('unstaged');
    expect(sourceFor(status.entries[1])).toBe('file');
    expect(sourceFor()).toBe('file');
    expect(sourceFor({ ...status.entries[0], worktree: '.' })).toBe('staged');
    expect(sourceFor({ ...status.entries[0], worktree: '.', index: '.' })).toBe(
      'file',
    );
    for (const code of ['A', 'D', 'C', 'M', 'R', '?'])
      expect(statusClass(code)).toBeTruthy();
  });
  it('orders flat paths the way the tree walks them', () => {
    expect(treeOrder(['src/a.ts', 'docs/b.md', 'src/c.ts'])).toEqual([
      'src/a.ts',
      'src/c.ts',
      'docs/b.md',
    ]);
  });
  it('classifies every file category by name alone', () => {
    const cases: [string, FileCategory][] = [
      ['photo.png', 'image'],
      ['clip.mkv', 'video'],
      ['song.flac', 'audio'],
      ['bundle.tar.gz', 'archive'],
      ['ubuntu.iso', 'disc'],
      ['nodes.ts', 'code'],
      ['index.css', 'web'],
      ['tauri.conf.json', 'config'],
      ['README.md', 'text'],
      ['report.docx', 'office'],
      ['Inter.woff2', 'font'],
      ['cache.sqlite', 'database'],
      ['installer.msi', 'executable'],
      ['unknown.qqq', 'generic'],
    ];
    for (const [name, category] of cases)
      expect(fileCategory(name, false)).toBe(category);
    expect(fileCategory('src', true)).toBe('folder');
    expect(fileCategory('.gitignore', false)).toBe('config');
    expect(fileCategory('Dockerfile', false)).toBe('config');
    expect(fileCategory('LICENSE', false)).toBe('generic');
    expect(fileCategory('.env', false)).toBe('generic');
    expect(fileCategory('APP.TS', false)).toBe('code');
  });
  it('resolves folder glyphs by name and expansion', () => {
    expect(folderGlyph('downloads', false)).toBe('downloads');
    expect(folderGlyph('.git', false)).toBe('git');
    expect(folderGlyph('node_modules', false)).toBe('modules');
    expect(folderGlyph('src', true)).toBe('open');
    expect(folderGlyph('src', false)).toBe('closed');
  });
  it('merges a directory with its only child directory', () => {
    const chain = (path: string) => ({
      ...status.entries[0],
      path,
      index: '.',
      worktree: 'M',
    });
    const merged = changeNodes(
      [chain('a/b/c/one.ts'), chain('a/b/c/two.ts')],
      'unstaged',
      '',
    );
    expect(merged[treeRoot].children).toEqual(['a']);
    expect(merged['a'].name).toBe('a/b/c');
    expect(merged['a'].path).toBe('a/b/c');
    expect(merged['a'].children).toEqual(['a/b/c/one.ts', 'a/b/c/two.ts']);
    expect(merged['a/b']).toBeUndefined();
    expect(merged['a/b/c']).toBeUndefined();
    const forked = changeNodes(
      [chain('a/b/c/one.ts'), chain('a/x.ts')],
      'unstaged',
      '',
    );
    expect(forked['a'].name).toBe('a');
    expect(forked['a'].children).toEqual(['a/b', 'a/x.ts']);
    expect(forked['a/b'].name).toBe('b/c');
    expect(forked['a/b'].path).toBe('a/b/c');
    const single = changeNodes([chain('a/only.ts')], 'unstaged', '');
    expect(single['a'].name).toBe('a');
  });
  it('marks directories partial only when a descendant is partly staged', () => {
    const entries = [
      {
        ...status.entries[0],
        path: 'src/staged.ts',
        index: 'M',
        worktree: '.',
      },
      {
        ...status.entries[0],
        path: 'src/unstaged.ts',
        index: '.',
        worktree: 'M',
      },
    ];
    for (const source of ['staged', 'unstaged'] as const) {
      expect(changeNodes(entries, source, '').src.partial).toBe(false);
      expect(
        changeNodes(
          [...entries, { ...status.entries[0], path: 'src/nested/both.ts' }],
          source,
          '',
        ).src.partial,
      ).toBe(true);
    }
  });
  it('accepts filenames that collide with object properties and the old root identifier', () => {
    const entries = ['root', 'constructor', '__proto__/file.ts'].map(
      (path) => ({ ...status.entries[0], path }),
    );
    const nodes = changeNodes(entries, 'staged', '');
    expect(nodes[treeRoot].children).toEqual([
      'root',
      'constructor',
      '__proto__',
    ]);
    expect(nodes.__proto__.children).toEqual(['__proto__/file.ts']);
  });
  it('derives gaps from hunk headers and numbers revealed lines on both sides', () => {
    expect(gaps(diff)).toEqual([]);
    expect(gaps({ ...gapped, content: 'text' })).toEqual([]);
    expect(gaps(gapped).map((gap) => gap.key)).toEqual([
      '1:26',
      '34:46',
      '54:',
    ]);
    const grown = {
      ...gapped,
      hunks: [
        { ...gapped.hunks[0], newCount: 8 },
        { ...gapped.hunks[1], newStart: 48 },
      ],
    };
    const [, mid] = gaps(grown);
    expect(mid).toMatchObject({ key: '35:47', offset: -1, hunk: 1 });
    const lines = gappedText.split('\n').slice(0, -1);
    const revealed = diffRows(grown, true, {
      lines,
      open: { '35:47': { down: 1, up: 0 } },
    }).find((row) => row.left?.new === 35);
    expect(revealed?.left).toMatchObject({
      kind: 'context',
      old: 34,
      new: 35,
      content: 'line 35',
    });
    const closed = diffRows(gapped, false, {
      lines,
      open: { '1:26': { down: 0, up: Infinity } },
    });
    expect(closed.filter((row) => row.gap).map((row) => row.gap?.key)).toEqual([
      '34:46',
      '54:',
    ]);
    expect(closed.find((row) => row.gap?.kind === 'end')?.gap?.hidden).toBe(47);
    expect(diffRows(gapped, false)[0].gap?.hidden).toBe(26);
  });
  it('pairs split rows and preserves unified content', () => {
    expect(diffRows(diff, true)).toHaveLength(3);
    expect(diffRows(diff, false)).toHaveLength(4);
    expect(diffRows({ ...diff, content: 'first\nsecond' }, false)).toHaveLength(
      2,
    );
    expect(
      diffRows({ ...diff, content: 'first', added: true }, false)[0].right
        ?.kind,
    ).toBe('add');
    expect(
      diffRows(
        {
          ...diff,
          hunks: [{ ...diff.hunks[0], lines: [diff.hunks[0].lines[2]] }],
        },
        true,
      )[1].right?.kind,
    ).toBe('add');
  });
  it('shares shortcuts without firing character actions inside inputs', () => {
    let calls = 0;
    const action = {
      id: 'stage',
      label: 'Stage',
      key: 's',
      run: () => {
        calls++;
      },
    };
    runShortcut(new KeyboardEvent('keydown', { key: 's' }), [action]);
    expect(calls).toBe(1);
    const event = new KeyboardEvent('keydown', { key: 's' });
    Object.defineProperty(event, 'target', {
      value: document.createElement('input'),
    });
    runShortcut(event, [action]);
    expect(calls).toBe(1);
    const functionKey = new KeyboardEvent('keydown', { key: 'F2' });
    Object.defineProperty(functionKey, 'target', {
      value: document.createElement('textarea'),
    });
    runShortcut(functionKey, [{ ...action, key: 'F2' }]);
    expect(calls).toBe(2);
    expect(
      matches(
        new KeyboardEvent('keydown', {
          key: 'p',
          metaKey: true,
          shiftKey: true,
        }),
        'Mod+Shift+p',
      ),
    ).toBe(true);
    expect(
      matches(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }),
        'Mod+Shift+p',
      ),
    ).toBe(false);
  });
  it('ranks fuzzy matches by adjacency, boundaries and length', () => {
    expect(fuzzyScore('xyz', 'src/app.ts')).toBeNull();
    expect(fuzzyScore('cp', 'CommandPalette.tsx')).toBeGreaterThan(
      fuzzyScore('cp', 'scripts/copy.js') ?? 0,
    );
    const files = ['src/lib/app-shell.ts', 'src/app.ts', 'README.md'];
    expect(fuzzyFilter('', files, (f) => f)).toBe(files);
    expect(fuzzyFilter('sapt', files, (f) => f)).toEqual([
      'src/app.ts',
      'src/lib/app-shell.ts',
    ]);
  });
  it('highlights syntax and safely encodes image references', async () => {
    expect(
      (await highlight('const value = "hello";', 'app.ts', false))[0].length,
    ).toBeGreaterThan(1);
    expect((await highlight('plain', 'unknown.xyz', true))[0][0].content).toBe(
      'plain',
    );
    expect(
      imageUrl('a & b', { path: 'a#b.png', source: 'staged' }, 'old'),
    ).toContain('path=a%23b.png');
    expect(
      imageUrl('r', { path: 'a.png', source: 'unstaged' }, 'new', 17),
    ).toContain('version=17');
  });
});

describe('modifier labels and syntax overlays', () => {
  it('uses the host modifier for both labels and dispatch', async () => {
    const { host } = await import('./harness');
    const { shortcutLabel } = await import('../lib/keyboard');
    expect(shortcutLabel('Mod+o')).toBe('⌘+o');
    expect(
      matches(
        new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }),
        'Mod+o',
      ),
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
      matches(
        new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }),
        'Mod+o',
      ),
    ).toBe(true);
    expect(
      matches(
        new KeyboardEvent('keydown', { key: 'o', metaKey: true }),
        'Mod+o',
      ),
    ).toBe(false);
  });
  it('keeps the flags of earlier passes when marking tokens again', async () => {
    const { markedTokens } = await import('../lib/highlight');
    expect(
      markedTokens(
        markedTokens([{ content: 'abc', color: 'red' }], [[0, 1]]),
        [[1, 3]],
        'found',
      ),
    ).toEqual([
      { content: 'a', color: 'red', changed: true, found: false },
      { content: 'bc', color: 'red', changed: false, found: true },
    ]);
  });
  it('finds every case-insensitive literal match with its offsets', async () => {
    const { findMatches } = await import('../components/diff/find');
    expect(findMatches(['Foo foo', 'bar', 'a.b(c a.b('], 'FOO')).toEqual([
      { index: 0, start: 0, end: 3 },
      { index: 0, start: 4, end: 7 },
    ]);
    expect(findMatches(['a.b(c a.b(', 'axb('], 'a.b(')).toEqual([
      { index: 0, start: 0, end: 4 },
      { index: 0, start: 6, end: 10 },
    ]);
    expect(findMatches(['anything'], '')).toEqual([]);
  });
  it('keeps syntax color while splitting a word mark across token boundaries', async () => {
    const { markedTokens } = await import('../lib/highlight');
    expect(
      markedTokens(
        [
          { content: 'const ', color: 'red' },
          { content: 'value', color: 'blue' },
        ],
        [[0, 8]],
      ),
    ).toEqual([
      { content: 'const ', color: 'red', changed: true },
      { content: 'va', color: 'blue', changed: true },
      { content: 'lue', color: 'blue', changed: false },
    ]);
  });
  it('splits tokens at UTF-16 range boundaries around astral and multi-byte characters', async () => {
    const { markedTokens } = await import('../lib/highlight');
    const line = 'h\u00e9llo \u{1f389} w\u00f6rld';
    const tokens = [
      { content: 'h\u00e9llo ', color: 'a' },
      { content: '\u{1f389} w', color: 'b' },
      { content: '\u00f6rld' },
    ];
    const marked = markedTokens(tokens, [
      [1, 2],
      [6, 8],
      [9, 14],
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
          [1, 3],
        ],
      ),
    ).toEqual([
      { content: 'a', color: undefined, changed: true },
      { content: 'bc', color: undefined, changed: true },
    ]);
  });
});
describe('git activity', () => {
  it('reads each git progress phase and ignores other lines', () => {
    expect(parseProgress('Enumerating objects: 5, done.')).toEqual({
      phase: 'Preparing',
      percent: undefined,
    });
    expect(parseProgress('remote: Counting objects:  40% (2/5)')).toEqual({
      phase: 'Counting',
      percent: 40,
    });
    expect(parseProgress('Compressing objects: 100% (3/3), done.')).toEqual({
      phase: 'Compressing',
      percent: 100,
    });
    expect(parseProgress('Writing objects:  62% (5/8)')?.phase).toBe('Sending');
    expect(parseProgress('Receiving objects:  45% (9/20)')?.percent).toBe(45);
    expect(parseProgress('Resolving deltas:   7% (1/14)')?.phase).toBe(
      'Finalizing',
    );
    expect(parseProgress('To github.com:owner/repo.git')).toBeNull();
  });
  it('labels every tracked command in plain words', () => {
    const label = <K extends keyof Commands>(
      command: K,
      args: Partial<Commands[K]['args']>,
      from = status,
    ) =>
      describeActivity(
        {
          id: 0,
          command,
          args,
          visible: true,
          held: false,
          done: false,
        } satisfies Activity,
        from,
      );
    expect(label('sync', { action: 'fetch' })).toBe('Fetching');
    expect(label('sync', { action: 'pull' })).toBe('Pulling from origin/main');
    expect(label('sync', { action: 'push' })).toBe('Pushing to origin/main');
    expect(
      label('sync', { action: 'push' }, { ...status, upstream: null }),
    ).toBe('Pushing to main');
    expect(label('commit', {})).toBe('Committing…');
    expect(label('stash_save', {})).toBe('Stashing…');
    expect(label('stash_apply', { pop: false })).toBe('Applying stash…');
    expect(label('stash_apply', { pop: true })).toBe('Popping stash…');
    expect(label('stash_drop', {})).toBe('Dropping stash…');
    expect(label('branch_switch', { name: 'main' })).toBe('Switching to main…');
    expect(label('smart_checkout', { name: 'dev' })).toBe('Switching to dev…');
    expect(label('branch_create', { name: 'dev' })).toBe('Creating dev…');
    expect(label('branch_delete', { name: 'dev' })).toBe('Deleting dev…');
    expect(label('branch_merge', { name: 'dev' })).toBe('Merging dev…');
    expect(label('merge_abort', {})).toBe('Aborting merge…');
    expect(label('files_action', { action: 'unstage' })).toBe('Unstaging…');
    expect(label('hunk_action', { action: 'discard' })).toBe('Discarding…');
    expect(label('hunk_action', { action: 'other' })).toBeNull();
    expect(label('refresh', {})).toBeNull();
  });
  it('reveals slow commands after a delay and holds them briefly', () => {
    vi.useFakeTimers();
    const scope = () => useActivity.getState().scopes.r ?? [];
    const quick = track('r', 'commit', { repo: 'r', message: 'm' });
    vi.advanceTimersByTime(299);
    expect(scope()).toMatchObject([{ visible: false, done: false }]);
    quick();
    vi.advanceTimersByTime(1000);
    expect(scope()).toEqual([]);
    const slow = track('r', 'sync', { repo: 'r', action: 'pull' });
    vi.advanceTimersByTime(300);
    handleEvent('sync://progress', {
      repo: 'r',
      message: 'Receiving objects:  45% (9/20)',
      done: false,
    });
    handleEvent('sync://progress', {
      repo: 'r',
      message: 'From github.com:owner/repo',
      done: false,
    });
    expect(scope()).toMatchObject([
      { visible: true, phase: 'Receiving', percent: 45 },
    ]);
    vi.advanceTimersByTime(100);
    slow();
    expect(scope()).toMatchObject([{ visible: true, done: true }]);
    vi.advanceTimersByTime(300);
    expect(scope()).toEqual([]);
    const long = track('r', 'stash_save', { repo: 'r', message: 'm' });
    vi.advanceTimersByTime(1000);
    long();
    expect(pendingActivity()).toEqual([]);
    vi.useRealTimers();
  });
});
describe('success notices', () => {
  it('describes each finished command in plain words', () => {
    const say = (
      command: string,
      args: Record<string, unknown>,
      result: unknown = null,
      before: Before = { status },
    ) => describeSuccess(command, args, result, before);
    const stashes = [
      {
        hash: 'h',
        selector: 'stash@{0}',
        message: 'On main: tidy',
        timestamp: 0,
      },
    ];
    expect(say('sync', { action: 'fetch' }, 4)).toEqual({
      key: 'sync:fetch',
      title: 'Fetched',
      description: '4 new commits',
    });
    expect(say('sync', { action: 'fetch' }, 1)?.description).toBe(
      '1 new commit',
    );
    expect(say('sync', { action: 'fetch' }, 1)?.info).toBeUndefined();
    expect(say('sync', { action: 'fetch' }, 0)).toMatchObject({
      description: 'Up to date',
      info: true,
    });
    expect(say('sync', { action: 'fetch' })?.description).toBeUndefined();
    expect(say('sync', { action: 'pull' }, 2)).toMatchObject({
      title: 'Pulled from origin/main',
      description: '2 commits',
    });
    expect(say('sync', { action: 'pull' }, 2)?.info).toBeUndefined();
    expect(say('sync', { action: 'pull' }, 0, {})).toMatchObject({
      title: 'Pulled from the remote',
      description: 'Already up to date',
      info: true,
    });
    expect(say('sync', { action: 'push' }, 3)).toMatchObject({
      title: 'Pushed to origin/main',
      description: '3 commits',
      replaces: 'commit',
    });
    expect(say('sync', { action: 'push' }, 3)?.info).toBeUndefined();
    expect(say('sync', { action: 'push' }, 0)).toMatchObject({
      title: 'Nothing to push',
      description: 'origin/main already has every commit',
      info: true,
    });
    expect(say('sync', { action: 'push' })?.title).toBe('Published main');
    expect(say('sync', { action: 'push' }, null, {})?.title).toBe(
      'Published branch',
    );
    expect(
      say('commit', { message: 'Fix typo\n\nBody' }, 'a1b2c3d4e5f6'),
    ).toMatchObject({ title: 'Committed', description: 'a1b2c3d Fix typo' });
    expect(say('stash_save', {}, 'h')?.description).toBe('2 files');
    expect(say('stash_save', {}, 'h', {})?.description).toBeUndefined();
    expect(
      say('stash_apply', { hash: 'h', pop: true }, null, { stashes }),
    ).toMatchObject({ title: 'Stash popped', description: 'On main: tidy' });
    expect(
      say('stash_apply', { hash: 'x', pop: false }, null, { stashes }),
    ).toEqual({ key: 'stash_apply', title: 'Stash applied' });
    expect(say('stash_drop', { hash: 'h' }, null, { stashes })).toMatchObject({
      title: 'Stash dropped',
      restore: { hash: 'h', message: 'On main: tidy' },
    });
    expect(say('stash_drop', { hash: 'x' }, null, {})?.restore).toBeUndefined();
    expect(
      say('stash_restore', { hash: 'h', message: 'On main: tidy' }),
    ).toMatchObject({ title: 'Stash restored', replaces: 'stash_drop' });
    expect(say('branch_switch', { name: 'dev' })).toEqual({
      key: 'branch_switch',
      title: 'Switched to dev',
    });
    expect(say('smart_checkout', { name: 'dev' })?.key).toBe('branch_switch');
    expect(say('branch_create', { name: 'dev' })?.title).toBe('Created dev');
    expect(say('branch_delete', { name: 'dev' })?.title).toBe('Deleted dev');
    expect(say('branch_merge', { name: 'dev' }, true)).toMatchObject({
      title: 'Merged dev',
      description: 'into main',
    });
    expect(say('branch_merge', { name: 'dev' }, false)).toBeNull();
    expect(say('merge_abort', {})?.title).toBe('Merge aborted');
    expect(
      say('files_action', { action: 'discard', paths: ['a', 'b'] }),
    ).toMatchObject({ title: 'Discarded changes', description: '2 files' });
    expect(
      say('files_action', { action: 'revert', paths: ['a'] }),
    ).toMatchObject({ title: 'Reverted', description: '1 file' });
    expect(say('files_action', { action: 'stage', paths: ['a'] })).toBeNull();
    expect(
      say('hunk_action', { action: 'discard', path: 'src/app.ts' }),
    ).toMatchObject({ description: 'src/app.ts' });
    expect(say('hunk_action', { action: 'unstage', path: 'a' })).toBeNull();
    expect(say('refresh', {})).toBeNull();
  });
  it('keeps one card per command, lets a push replace its commit, and keeps three', () => {
    const { announce, dismiss } = useSuccesses.getState();
    const titles = () =>
      (useSuccesses.getState().scopes.r ?? []).map((notice) => notice.title);
    announce('r', { key: 'commit', title: 'Committed' });
    announce('r', { key: 'sync:fetch', title: 'Fetched' });
    announce('r', { key: 'sync:fetch', title: 'Fetched again' });
    expect(titles()).toEqual(['Committed', 'Fetched again']);
    announce('r', { key: 'sync:push', title: 'Pushed', replaces: 'commit' });
    expect(titles()).toEqual(['Fetched again', 'Pushed']);
    announce('r', { key: 'a', title: 'A' });
    announce('r', { key: 'b', title: 'B' });
    expect(titles()).toEqual(['Pushed', 'A', 'B']);
    dismiss('r', useSuccesses.getState().scopes.r[0].id);
    expect(titles()).toEqual(['A', 'B']);
  });
});

describe('highlighting worker', () => {
  const code = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => `const row${index} = ${index};`,
    );
  function start(react: (reply: Reply) => void = () => {}) {
    const replies: Reply[] = [];
    const worker = highlightWorker((reply) => {
      replies.push(reply);
      react(reply);
    });
    const finished = (id: number) =>
      replies.some(
        (reply) => reply.id === id && ('failed' in reply || reply.done),
      );
    return { replies, worker, finished };
  }
  const chunksOf = (replies: Reply[], id: number) =>
    replies.flatMap((reply) =>
      reply.id === id && !('failed' in reply) ? [reply] : [],
    );
  it('delivers 500-line chunks and carries the grammar state across them', async () => {
    const { replies, worker, finished } = start();
    const lines = code(1200);
    lines[498] = '/*';
    lines[499] = 'still a comment';
    lines[500] = 'still a comment';
    lines[501] = '*/';
    worker.receive({ type: 'job', id: 1, path: 'a.ts', dark: false, lines });
    await waitFor(() => expect(finished(1)).toBe(true));
    const chunks = chunksOf(replies, 1);
    expect(
      chunks.map(({ start, lines, done }) => [start, lines.length, done]),
    ).toEqual([
      [0, 500, false],
      [500, 500, false],
      [1000, 200, true],
    ]);
    const tokens = chunks.flatMap((chunk) => chunk.lines);
    const comment = tokens[498][0].color;
    expect(comment).toBeDefined();
    expect(tokens[499][0].color).toBe(comment);
    expect(tokens[500][0].color).toBe(comment);
    expect(tokens[502].some((token) => token.color !== comment)).toBe(true);
    expect(worker.languages()).toContain('typescript');
  });
  it('leaves an overlong line as one uncoloured token and plain text for unknown languages', async () => {
    const { replies, worker, finished } = start();
    const long = `const text = "${'a'.repeat(2500)}";`;
    worker.receive({
      type: 'job',
      id: 1,
      path: 'notes.unknown',
      dark: true,
      lines: ['plain', ''],
    });
    await waitFor(() => expect(finished(1)).toBe(true));
    expect(chunksOf(replies, 1)[0].lines).toEqual([
      [{ content: 'plain' }],
      [{ content: '' }],
    ]);
    expect(worker.languages()).toEqual([]);
    worker.receive({
      type: 'job',
      id: 2,
      path: 'a.ts',
      dark: false,
      lines: ['const shown = 1;', long, 'const after = 2;'],
    });
    await waitFor(() => expect(finished(2)).toBe(true));
    const [first, capped, after] = chunksOf(replies, 2)[0].lines;
    expect(capped).toEqual([{ content: long }]);
    expect(first.some((token) => token.color)).toBe(true);
    expect(after.some((token) => token.color)).toBe(true);
  });
  it('interleaves queued jobs, stops cancelled ones at a chunk boundary, and reports failures', async () => {
    const { replies, worker, finished } = start((reply) => {
      if (reply.id === 3) worker.receive({ type: 'cancel', id: 3 });
    });
    const job = (id: number, lines: string[]) =>
      worker.receive({ type: 'job', id, path: 'a.ts', dark: false, lines });
    job(1, code(1500));
    job(2, code(10));
    job(3, code(1500));
    job(4, code(10));
    worker.receive({ type: 'cancel', id: 4 });
    job(5, undefined as unknown as string[]);
    await waitFor(() => expect(finished(1) && finished(5)).toBe(true));
    const small = replies.findIndex((reply) => reply.id === 2);
    const large = replies.findIndex(
      (reply) => reply.id === 1 && !('failed' in reply) && reply.done,
    );
    expect(small).toBeGreaterThanOrEqual(0);
    expect(small).toBeLessThan(large);
    expect(chunksOf(replies, 3)).toHaveLength(1);
    expect(replies.some((reply) => reply.id === 4)).toBe(false);
    expect(replies).toContainEqual({ id: 5, failed: true });
  });
  it('serves one-shot requests and survives fake timers', async () => {
    vi.useFakeTimers();
    const lines = await highlight(code(1200).join('\n'), 'a.ts', true);
    expect(lines).toHaveLength(1200);
    expect(lines[1199].some((token) => token.color)).toBe(true);
    vi.useRealTimers();
    workers.failing = true;
    expect(await highlight('const a = 1;\nb', 'a.ts', false)).toEqual([
      [{ content: 'const a = 1;' }],
      [{ content: 'b' }],
    ]);
  });
  it('fails every pending job to plain tokens when the worker breaks, then starts afresh', async () => {
    for (const type of ['error', 'messageerror'] as const) {
      workers.held = true;
      const streamed: [number, number, boolean][] = [];
      tokenize(['a', 'b'], 'a.ts', false, (start, lines, done) =>
        streamed.push([start, lines.length, done]),
      );
      const oneShot = highlight('x', 'a.ts', false);
      const broken = workers.live!;
      await waitFor(() => expect(workers.queued.length).toBe(2));
      act(() => broken.fail(type));
      expect(streamed).toEqual([[0, 2, true]]);
      expect(await oneShot).toEqual([[{ content: 'x' }]]);
      workers.held = false;
      workers.queued = [];
      const before = workers.created;
      expect(await highlight('y', 'a.ts', false)).toHaveLength(1);
      expect(workers.created).toBe(before + 1);
      expect(workers.live).not.toBe(broken);
    }
    workers.held = true;
    const pending = highlight('z', 'a.ts', false);
    terminate();
    expect(await pending).toEqual([[{ content: 'z' }]]);
    expect(workers.live).toBeUndefined();
  });
});
