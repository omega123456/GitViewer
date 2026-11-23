import { memo, useEffect, useState } from 'react';
import { Archive, Copy, CopyMinus, Trash2 } from 'lucide-react';
import { useActions } from '../../lib/actions';
import { useBackend } from '../../lib/query';
import { applyStash, dropStash } from '../../lib/stash';
import { useOpenFile } from '../../lib/open-file';
import type { Action } from '../../lib/keyboard';
import type { Selection, Stash } from '../../lib/types';
import { useCurrentActivity, type Activity } from '../../stores/activity';
import {
  useLayout,
  useLayoutField,
  sectionHeightBounds,
} from '../../stores/layout';
import { useReveal } from '../../stores/reveal';
import { useWorkingSelection } from '../../stores/selection';
import { Decision } from '../shared/Decision';
import { ErrorRetry } from '../states/Errors';
import { Section } from '../shared/Section';
import { dynamic } from '../shared/styles';
import { VirtualList } from '../shared/VirtualList';
import { SectionResizeHandle } from '../shell/ResizeHandle';
import { revisionTree } from '../sidebar/reveal';
import { scopeKey } from '../../lib/git';
import { StashFilesPane, StashRow } from './StashRow';
function stashActions({
  repo,
  selected,
  disabled,
}: {
  repo: string;
  selected: string;
  disabled: boolean;
}): Action[] {
  return [
    {
      id: 'apply-stash',
      icon: <Copy className="size-3.5" />,
      label: 'Apply selected stash',
      key: 'Mod+Alt+a',
      disabled: disabled,
      run: () => applyStash({ repo: repo, hash: selected, pop: false }),
    },
    {
      id: 'pop-stash',
      icon: <CopyMinus className="size-3.5" />,
      label: 'Pop selected stash',
      key: 'Mod+Alt+p',
      disabled: disabled,
      run: () => applyStash({ repo: repo, hash: selected, pop: true }),
    },
    {
      id: 'drop-stash',
      icon: <Trash2 className="size-3.5" />,
      label: 'Drop selected stash',
      key: 'Mod+Alt+Backspace',
      disabled: disabled,
      run: () => dropStash(repo, selected),
    },
  ];
}
function useStashReveal(
  repo: string,
  selection: Selection | undefined,
  setSelected: (revision: string) => void,
) {
  const revealing = useReveal((state) => state.targets[repo]);
  useEffect(() => {
    if (!revealing || !selection) return;
    const stashRevision =
      selection.source === 'stash' ? selection.revision : undefined;
    if (!stashRevision) return;
    if (revealing.tree === revisionTree(selection)) setSelected(stashRevision);
  }, [revealing, selection, setSelected]);
}
interface StashShellState {
  selected: string;
  selection: Selection | undefined;
  disabled: boolean;
  activity: Activity | undefined;
  onSelectStash: (hash: string) => void;
  onShowFile: (path: string) => void;
}
function StashListContent({
  repo,
  stashes,
  state,
}: {
  repo: string;
  stashes: Stash[];
  state: StashShellState;
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <VirtualList
          label="Stashes"
          items={stashes}
          render={(stash) => (
            <StashRow
              repo={repo}
              stash={stash}
              selected={state.selected === stash.hash}
              disabled={state.disabled}
              activity={state.activity}
              onSelect={() => state.onSelectStash(stash.hash)}
            />
          )}
        />
      </div>
      {state.selected && (
        <StashFilesPane
          repo={repo}
          selected={state.selected}
          selection={state.selection}
          onShow={state.onShowFile}
        />
      )}
    </>
  );
}
function StashSectionShell({
  repo,
  stashes,
  state,
}: {
  repo: string;
  stashes: Stash[];
  state: StashShellState;
}) {
  const stashOpen = useLayoutField(repo, 'stashOpen');
  const stashHeight = useLayoutField(repo, 'stashHeight');
  const containerClass = stashOpen
    ? 'relative flex h-stash min-h-0 flex-col'
    : 'relative flex flex-col';
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
        className={containerClass}
        style={dynamic({ '--stash-height': `${stashHeight}%` })}
      >
        <Decision
          repo={repo}
          slot="stash"
          className="inset-x-0 top-0 h-section"
        />
        <Section
          title="Stashes"
          count={stashes.length}
          open={stashOpen}
          onOpenChange={(next) =>
            useLayout.getState().update(repo, { stashOpen: next })
          }
          icon={<Archive className="size-3" />}
        >
          <StashListContent repo={repo} stashes={stashes} state={state} />
        </Section>
      </div>
    </>
  );
}
export const StashSection = memo(function StashSection({
  repo,
  disabled,
}: {
  repo: string;
  disabled: boolean;
}) {
  const query = useBackend('stashes', { repo });
  const selection = useWorkingSelection(repo);
  const [selected, setSelected] = useState('');
  useStashReveal(repo, selection, setSelected);
  const activity = useCurrentActivity(repo);
  const openFile = useOpenFile(repo);
  const show = (path: string, revision: string) => {
    useLayout.getState().update(repo, { mode: 'working' });
    openFile({ path: path, source: 'stash', revision: revision });
  };
  const hasSelectedStash = Boolean(
    query.data?.some((stash) => stash.hash === selected),
  );
  useActions(
    scopeKey(repo, 'stashes'),
    stashActions({
      repo: repo,
      selected: selected,
      disabled: disabled || !hasSelectedStash,
    }),
  );
  if (query.error)
    return <ErrorRetry label="Could not load stashes" query={query} />;
  if (!query.data?.length) return null;
  return (
    <StashSectionShell
      repo={repo}
      stashes={query.data}
      state={{
        selected: selected,
        selection: selection,
        disabled: disabled,
        activity: activity,
        onSelectStash: (hash) => {
          setSelected(hash);
          show('', hash);
        },
        onShowFile: (path) => show(path, selected),
      }}
    />
  );
});
