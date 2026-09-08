import { useState } from 'react';
import { formatDistanceToNowStrict, fromUnixTime } from 'date-fns';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  Archive,
  ArrowDownFromLine,
  ArrowDownToLine,
  Plus,
  Trash2,
} from 'lucide-react';
import { useActions } from '../../lib/actions';
import { perform, useBackend } from '../../lib/query';
import type { Action } from '../../lib/keyboard';
import { useTabs } from '../../stores/tabs';
import { useLayout } from '../../stores/layout';
import { useSelection } from '../../stores/selection';
import { Button } from '../shared/Button';
import { GroupHeader, Section } from '../shared/Section';
import { VirtualList } from '../shared/VirtualList';
export function StashSection({
  repo,
  disabled,
}: {
  repo: string;
  disabled: boolean;
}) {
  const query = useBackend('stashes', { repo });
  const [selected, setSelected] = useState('');
  const files = useBackend(
    'commit_files',
    { repo, revision: selected, source: 'stash' },
    Boolean(selected),
  );
  const show = (path: string, revision: string) => {
    useLayout.getState().update(repo, { history: false });
    useSelection.getState().select(repo, { path, source: 'stash', revision });
  };
  const apply = async (pop: boolean) => {
    if (
      pop &&
      !(await confirm('Apply and remove this stash?', { title: 'Pop stash' }))
    )
      return;
    const result = await perform('stash_apply', {
      repo,
      hash: selected,
      pop,
      smart: false,
    });
    if (
      result === undefined &&
      useTabs.getState().error?.category === 'smart_apply' &&
      (await confirm(
        'Temporarily stash local changes and combine them if the changed paths are disjoint?',
        { title: 'Smart apply' },
      ))
    )
      await perform('stash_apply', {
        repo,
        hash: selected,
        pop,
        smart: true,
      });
  };
  const drop = async () => {
    if (
      await confirm('Permanently drop this stash?', {
        title: 'Drop stash',
        kind: 'warning',
      })
    )
      await perform('stash_drop', { repo, hash: selected });
  };
  const actions: Action[] = [
    {
      id: 'apply-stash',
      icon: <ArrowDownToLine className="size-3.5" />,
      label: 'Apply selected stash',
      key: 'Mod+Alt+a',
      disabled:
        disabled || !query.data?.some((stash) => stash.hash === selected),
      run: () => apply(false),
    },
    {
      id: 'pop-stash',
      icon: <ArrowDownFromLine className="size-3.5" />,
      label: 'Pop selected stash',
      key: 'Mod+Alt+p',
      disabled:
        disabled || !query.data?.some((stash) => stash.hash === selected),
      run: () => apply(true),
    },
    {
      id: 'drop-stash',
      icon: <Trash2 className="size-3.5" />,
      label: 'Drop selected stash',
      key: 'Mod+Alt+Backspace',
      disabled:
        disabled || !query.data?.some((stash) => stash.hash === selected),
      run: drop,
    },
  ];
  useActions(`${repo}:stashes`, actions);
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data?.length) return null;
  return (
    <Section
      title="Stashes"
      count={query.data.length}
      defaultOpen={false}
      grow={false}
      icon={<Archive className="size-3" />}
    >
      <div className="flex h-28 flex-col">
        <VirtualList
          label="Stashes"
          items={query.data}
          render={(stash) => (
            <Button
              className={`h-tree-comfortable w-full justify-start truncate ${selected === stash.hash ? 'bg-selected dark:bg-selected-dark' : ''}`}
              onClick={() => {
                setSelected(stash.hash);
                show('', stash.hash);
              }}
            >
              <Archive className="size-3 text-faint dark:text-faint-dark" />
              <span className="min-w-0 flex-1 truncate">{stash.message}</span>
              <span className="font-mono text-label text-muted">
                {formatDistanceToNowStrict(fromUnixTime(stash.timestamp))}
              </span>
            </Button>
          )}
        />
      </div>
      {selected && (
        <div className="flex h-28 flex-col border-t border-line dark:border-line-dark">
          <GroupHeader title="Stash files" count={files.data?.length ?? 0} />
          {files.error && <p role="alert">{files.error.message}</p>}
          <VirtualList
            label="Stash files"
            items={files.data ?? []}
            render={(path) => (
              <Button
                className="h-tree-comfortable w-full justify-start truncate"
                onClick={() => show(path, selected)}
              >
                {path}
              </Button>
            )}
          />
        </div>
      )}
      <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-line bg-sub p-2 dark:border-line-dark dark:bg-sub-dark">
        <Button
          className="border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
          disabled={disabled}
          onClick={() =>
            void perform('stash_save', {
              repo,
              message: 'Saved from GitViewer',
            })
          }
        >
          <Plus className="size-3" />
          Stash changes
        </Button>
        <Button
          className="border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
          disabled={disabled || !selected}
          onClick={() => void apply(false)}
        >
          <ArrowDownToLine className="size-3" />
          Apply
        </Button>
        <Button
          className="border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
          disabled={disabled || !selected}
          onClick={() => void apply(true)}
        >
          <ArrowDownFromLine className="size-3" />
          Pop
        </Button>
        <Button
          title="Drop stash"
          className="border border-line bg-surface text-deleted dark:border-line-dark dark:bg-surface-dark dark:text-deleted-dark"
          disabled={disabled || !selected}
          onClick={() => void drop()}
        >
          <Trash2 className="size-3" />
          Drop
        </Button>
      </div>
    </Section>
  );
}
