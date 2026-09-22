import { describe, it, expect } from 'vitest';
import { invoke, normalizeError } from '../lib/ipc';
import { client, connectEvents, perform, queryKey } from '../lib/query';
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
import { highlight } from '../lib/highlight';
import { fuzzyFilter, fuzzyScore } from '../lib/fuzzy';
import { diffRows } from '../components/diff/rows';
import { fileCategory, folderGlyph, type FileCategory } from '../lib/file-type';
import {
  changeNodes,
  sourceFor,
  statusClass,
  treeRoot,
} from '../components/sidebar/nodes';
import { imageUrl } from '../components/image/url';
import { emit, mockCommand } from './harness';
import { diff, status } from './fixtures';
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
    expect(useTabs.getState().busy).toBe(0);
    expect(useTabs.getState().error?.category).toBe('refused');
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
    useTabs.getState().setBusy(-5);
    expect(useTabs.getState().busy).toBe(0);
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
  it('pairs split rows and preserves unified content', () => {
    expect(diffRows(diff, true)).toHaveLength(3);
    expect(diffRows(diff, false)).toHaveLength(4);
    expect(diffRows({ ...diff, content: 'first\nsecond' }, false)).toHaveLength(
      2,
    );
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
      imageUrl('r', { path: 'a.png', source: 'working' }, 'new', 17),
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
    host.platform = 'windows';
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
  it('keeps syntax color while splitting a word mark across token boundaries', async () => {
    const { markedTokens } = await import('../lib/highlight');
    expect(
      markedTokens(
        [
          { content: 'const ', color: 'red' },
          { content: 'value', color: 'blue' },
        ],
        [
          { text: 'const va', changed: true },
          { text: 'lue', changed: false },
        ],
      ),
    ).toEqual([
      { content: 'const ', color: 'red', changed: true },
      { content: 'va', color: 'blue', changed: true },
      { content: 'lue', color: 'blue', changed: false },
    ]);
  });
});
