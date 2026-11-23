import { RevisionTree } from '../sidebar/RevisionTree';
import { revisionTree } from '../sidebar/reveal';
import { memo, useEffect, useState } from 'react';
import { elapsedTime } from '../../lib/time';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Archive, Copy, CopyMinus, Trash2 } from 'lucide-react';
import { useActions } from '../../lib/actions';
import { attempt, perform, useBackend } from '../../lib/query';
import { normalizeError } from '../../lib/ipc';
import type { Action } from '../../lib/keyboard';
import { runs, useCurrentActivity } from '../../stores/activity';
import { ask } from '../../stores/decision';
import { useErrors } from '../../stores/errors';
import {
  useLayout,
  useLayoutField,
  sectionHeightBounds,
  stashFilesHeightBounds,
} from '../../stores/layout';
import { useReveal } from '../../stores/reveal';
import { useSelection, useWorkingSelection } from '../../stores/selection';
import { Button } from '../shared/Button';
import { ViewAllButton } from '../shared/ViewAllButton';
import { Decision } from '../shared/Decision';
import { ErrorRetry } from '../states/Errors';
import { GroupHeader, Section } from '../shared/Section';
import { BusyIcon } from '../shared/BusyIcon';
import {
  dynamic,
  pill,
  pinnedSlot,
  revealSlot,
  rowTint,
  selectedRow,
  removedInk,
} from '../shared/styles';
import { VirtualList } from '../shared/VirtualList';
import { SectionResizeHandle } from '../shell/ResizeHandle';
import { scopeKey } from '../../lib/git';
export const StashSection = memo(function StashSection({
  repo,
  disabled,
}: {
  repo: string;
  disabled: boolean;
}) {
  const query = useBackend('stashes', { repo });
  const stashOpen = useLayoutField(repo, 'stashOpen');
  const stashHeight = useLayoutField(repo, 'stashHeight');
  const stashFilesHeight = useLayoutField(repo, 'stashFilesHeight');
  const selection = useWorkingSelection(repo);
  const [selected, setSelected] = useState('');
  const revealing = useReveal((state) => state.targets[repo]);
  useEffect(() => {
    if (
      revealing &&
      selection?.source === 'stash' &&
      selection.revision &&
      revealing.tree === revisionTree(selection)
    )
      setSelected(selection.revision);
  }, [revealing, selection]);
  const activity = useCurrentActivity(repo);
  const files = useBackend(
    'commit_files',
    { repo: repo, revision: selected, source: 'stash' },
    Boolean(selected),
  );
  const show = (path: string, revision: string) => {
    useLayout.getState().update(repo, { mode: 'working' });
    useSelection
      .getState()
      .select(repo, { path: path, source: 'stash', revision: revision });
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
    try {
      await attempt('stash_apply', {
        repo: repo,
        hash: hash,
        pop: pop,
        smart: false,
      });
      useErrors.getState().resolve(repo, 'stash_apply');
    } catch (error) {
      const failure = normalizeError(error);
      if (failure.category !== 'smart_apply')
        useErrors.getState().report(repo, failure, { command: 'stash_apply' });
      else if (
        await ask(repo, {
          slot: 'stash',
          title: 'Combine with your changes?',
          body: 'Your working tree has changes. GitViewer can apply the stash on top of them when they touch different files.',
          confirm: pop ? 'Pop and combine' : 'Apply and combine',
        })
      )
        await perform('stash_apply', {
          repo: repo,
          hash: hash,
          pop: pop,
          smart: true,
        });
    }
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
  useActions(scopeKey(repo, 'stashes'), actions);
  if (query.error)
    return <ErrorRetry label="Could not load stashes" query={query} />;
  if (!query.data?.length) return null;
  return (
    <>
      {stashOpen && (
        <SectionResizeHandle
          label="Resize stash section"
          bounds={sectionHeightBounds}
          value={stashHeight}
          onChange={(next) =>
            useLayout.getState().update(repo, { stashHeight: next })
          }
        />
      )}
      <div
        className={
          stashOpen
            ? 'relative flex h-stash min-h-0 flex-col'
            : 'relative flex flex-col'
        }
        style={dynamic({ '--stash-height': `${stashHeight}%` })}
      >
        <Decision
          repo={repo}
          slot="stash"
          className="inset-x-0 top-0 h-section"
        />
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
              render={(stash) => {
                const applying = runs(activity, 'stash_apply', {
                  hash: stash.hash,
                  pop: false,
                });
                const popping = runs(activity, 'stash_apply', {
                  hash: stash.hash,
                  pop: true,
                });
                const dropping = runs(activity, 'stash_drop', {
                  hash: stash.hash,
                });
                return (
                  <div
                    className={`group relative mx-1 flex items-center rounded ${rowTint} ${selected === stash.hash ? selectedRow : ''}`}
                  >
                    {selected === stash.hash && <span className={pill} />}
                    <Button
                      className="h-tree-comfortable w-full justify-start truncate text-left"
                      onClick={() => {
                        setSelected(stash.hash);
                        show('', stash.hash);
                      }}
                    >
                      <Archive className="size-3.75 shrink-0 text-muted dark:text-muted-dark" />
                      <span className="min-w-0 flex-1 truncate">
                        {stash.message}
                      </span>
                      <span className="shrink-0 font-mono text-badge text-muted dark:text-muted-dark">
                        {elapsedTime(stash.timestamp)}
                      </span>
                    </Button>
                    <div
                      className={`${selected === stash.hash || applying || popping || dropping ? pinnedSlot : revealSlot} right-1`}
                    >
                      <Button
                        variant="icon"
                        className="size-6"
                        aria-busy={applying}
                        aria-label={`Apply ${stash.selector}`}
                        title={`Apply ${stash.selector}`}
                        disabled={disabled}
                        onClick={() => void apply(stash.hash, false)}
                      >
                        <BusyIcon
                          busy={applying}
                          icon={Copy}
                          className="size-3"
                        />
                      </Button>
                      <Button
                        variant="icon"
                        className="size-6"
                        aria-busy={popping}
                        aria-label={`Pop ${stash.selector}`}
                        title={`Pop ${stash.selector}`}
                        disabled={disabled}
                        onClick={() => void apply(stash.hash, true)}
                      >
                        <BusyIcon
                          busy={popping}
                          icon={CopyMinus}
                          className="size-3"
                        />
                      </Button>
                      <span className="w-1.5 shrink-0" />
                      <Button
                        variant="icon"
                        className={`size-6 ${removedInk}`}
                        aria-busy={dropping}
                        aria-label={`Drop ${stash.selector}`}
                        title={`Drop ${stash.selector}`}
                        disabled={disabled}
                        onClick={() => void drop(stash.hash)}
                      >
                        <BusyIcon
                          busy={dropping}
                          icon={Trash2}
                          className="size-3"
                        />
                      </Button>
                    </div>
                  </div>
                );
              }}
            />
          </div>
          {selected && (
            <>
              <SectionResizeHandle
                label="Resize stash files"
                bounds={stashFilesHeightBounds}
                value={stashFilesHeight}
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
                  count={Object.keys(files.data?.statuses ?? {}).length}
                  actions={
                    <ViewAllButton
                      repo={repo}
                      stack="commit"
                      label="All changes in stash"
                      look="section"
                    />
                  }
                />
                <ErrorRetry
                  label="Could not load the stash files"
                  query={files}
                />
                {files.data && (
                  <RevisionTree
                    key={selected}
                    repo={repo}
                    tree={revisionTree({ source: 'stash', revision: selected })}
                    label="Stash files"
                    paths={Object.keys(files.data.statuses)}
                    statuses={files.data.statuses}
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
});
