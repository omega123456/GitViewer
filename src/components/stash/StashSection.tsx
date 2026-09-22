import { RevisionTree } from '../sidebar/RevisionTree';
import { useState } from 'react';
import { formatDistanceToNowStrict, fromUnixTime } from 'date-fns';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Archive, Copy, CopyMinus, Layers, Trash2 } from 'lucide-react';
import { useActions } from '../../lib/actions';
import { perform, useBackend } from '../../lib/query';
import type { Action } from '../../lib/keyboard';
import { useTabs } from '../../stores/tabs';
import { useLayout, useTabLayout } from '../../stores/layout';
import { useSelection, useWorkingSelection } from '../../stores/selection';
import { Button } from '../shared/Button';
import { GroupHeader, Section } from '../shared/Section';
import { dynamic, pinnedSlot, revealSlot, rowTint } from '../shared/styles';
import { VirtualList } from '../shared/VirtualList';
import { percentBelow, ResizeHandle } from '../shell/ResizeHandle';
export function StashSection({
  repo,
  disabled,
}: {
  repo: string;
  disabled: boolean;
}) {
  const query = useBackend('stashes', { repo });
  const { stashOpen, stashHeight, stashFilesHeight } = useTabLayout(repo);
  const selection = useWorkingSelection(repo);
  const [selected, setSelected] = useState('');
  const files = useBackend(
    'commit_files',
    { repo, revision: selected, source: 'stash' },
    Boolean(selected),
  );
  const show = (path: string, revision: string) => {
    useLayout.getState().update(repo, { mode: 'working' });
    useSelection.getState().select(repo, { path, source: 'stash', revision });
  };
  const apply = async (hash: string, pop: boolean) => {
    if (
      !(await confirm(
        pop
          ? 'Apply and remove this stash?'
          : 'Apply this stash and keep it on the stack?',
        { title: pop ? 'Pop stash' : 'Apply stash' },
      ))
    )
      return;
    const result = await perform('stash_apply', {
      repo,
      hash,
      pop,
      smart: false,
    });
    if (
      result === undefined &&
      useTabs.getState().error?.category === 'smart_apply' &&
      (await confirm(
        'Combine this stash with local changes if the changed paths are disjoint?',
        { title: 'Smart apply' },
      ))
    )
      await perform('stash_apply', {
        repo,
        hash,
        pop,
        smart: true,
      });
  };
  const drop = async (hash: string) => {
    if (
      await confirm('Permanently drop this stash?', {
        title: 'Drop stash',
        kind: 'warning',
      })
    )
      await perform('stash_drop', { repo, hash });
  };
  const actions: Action[] = [
    {
      id: 'apply-stash',
      icon: <Copy className="size-3.5" />,
      label: 'Apply selected stash',
      key: 'Mod+Alt+a',
      disabled:
        disabled || !query.data?.some((stash) => stash.hash === selected),
      run: () => apply(selected, false),
    },
    {
      id: 'pop-stash',
      icon: <CopyMinus className="size-3.5" />,
      label: 'Pop selected stash',
      key: 'Mod+Alt+p',
      disabled:
        disabled || !query.data?.some((stash) => stash.hash === selected),
      run: () => apply(selected, true),
    },
    {
      id: 'drop-stash',
      icon: <Trash2 className="size-3.5" />,
      label: 'Drop selected stash',
      key: 'Mod+Alt+Backspace',
      disabled:
        disabled || !query.data?.some((stash) => stash.hash === selected),
      run: () => drop(selected),
    },
  ];
  useActions(`${repo}:stashes`, actions);
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data?.length) return null;
  return (
    <>
      {stashOpen && (
        <ResizeHandle
          label="Resize stash section"
          orientation="vertical"
          min={20}
          max={60}
          step={2}
          value={stashHeight}
          className="h-1.5 shrink-0 cursor-row-resize border-y border-line hover:bg-accent focus-visible:bg-accent dark:border-line-dark"
          measure={percentBelow}
          onChange={(next) =>
            useLayout.getState().update(repo, { stashHeight: next })
          }
        />
      )}
      <div
        className={
          stashOpen ? 'flex h-stash min-h-0 flex-col' : 'flex flex-col'
        }
        style={dynamic({ '--stash-height': `${stashHeight}%` })}
      >
        <Section
          title="Stashes"
          count={query.data.length}
          open={stashOpen}
          onOpenChange={(next) =>
            useLayout.getState().update(repo, { stashOpen: next })
          }
          icon={<Archive className="size-3" />}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <VirtualList
              label="Stashes"
              items={query.data}
              render={(stash) => (
                <div
                  className={`group relative flex w-full items-center ${rowTint} ${selected === stash.hash ? 'bg-selected dark:bg-selected-dark' : ''}`}
                >
                  <Button
                    className="h-tree-comfortable w-full justify-start truncate text-left"
                    onClick={() => {
                      setSelected(stash.hash);
                      show('', stash.hash);
                    }}
                  >
                    <Archive className="size-3 shrink-0 text-faint dark:text-faint-dark" />
                    <span className="min-w-0 flex-1 truncate">
                      {stash.message}
                    </span>
                    <span className="shrink-0 font-mono text-label text-muted">
                      {formatDistanceToNowStrict(fromUnixTime(stash.timestamp))}
                    </span>
                  </Button>
                  <div
                    className={`${selected === stash.hash ? pinnedSlot : revealSlot} right-1`}
                  >
                    <Button
                      variant="icon"
                      className="size-6"
                      aria-label={`Apply ${stash.selector}`}
                      title={`Apply ${stash.selector}`}
                      disabled={disabled}
                      onClick={() => void apply(stash.hash, false)}
                    >
                      <Copy className="size-3" />
                    </Button>
                    <Button
                      variant="icon"
                      className="size-6"
                      aria-label={`Pop ${stash.selector}`}
                      title={`Pop ${stash.selector}`}
                      disabled={disabled}
                      onClick={() => void apply(stash.hash, true)}
                    >
                      <CopyMinus className="size-3" />
                    </Button>
                    <span className="w-1.5 shrink-0" />
                    <Button
                      variant="icon"
                      className="size-6 text-deleted dark:text-deleted-dark"
                      aria-label={`Drop ${stash.selector}`}
                      title={`Drop ${stash.selector}`}
                      disabled={disabled}
                      onClick={() => void drop(stash.hash)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              )}
            />
          </div>
          {selected && (
            <>
              <ResizeHandle
                label="Resize stash files"
                orientation="vertical"
                min={20}
                max={80}
                step={2}
                value={stashFilesHeight}
                className="h-1.5 shrink-0 cursor-row-resize border-y border-line hover:bg-accent focus-visible:bg-accent dark:border-line-dark"
                measure={percentBelow}
                onChange={(next) =>
                  useLayout.getState().update(repo, { stashFilesHeight: next })
                }
              />
              <div
                className="flex h-stash-files min-h-0 shrink-0 flex-col"
                style={dynamic({
                  '--stash-files-height': `${stashFilesHeight}%`,
                })}
              >
                <GroupHeader
                  title="Stash files"
                  count={files.data?.length ?? 0}
                  actions={
                    <Button
                      variant="icon"
                      className="size-6"
                      aria-label="All changes in stash"
                      title="All changes in stash"
                      onClick={() =>
                        useSelection.getState().viewAll(repo, 'commit')
                      }
                    >
                      <Layers className="size-4 text-muted dark:text-muted-dark" />
                    </Button>
                  }
                />
                {files.error && <p role="alert">{files.error.message}</p>}
                {files.data && (
                  <RevisionTree
                    key={selected}
                    label="Stash files"
                    paths={files.data}
                    selectedPath={
                      selection?.source === 'stash' &&
                      selection.revision === selected
                        ? selection.path
                        : undefined
                    }
                    onSelect={(path) => show(path, selected)}
                  />
                )}
              </div>
            </>
          )}
        </Section>
      </div>
    </>
  );
}
