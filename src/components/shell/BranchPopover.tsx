import { TextInput } from '../shared/TextInput';
import { useState } from 'react';
import { Popover } from 'radix-ui';
import {
  GitBranch,
  GitCompare,
  Plus,
  Search,
  Trash2,
  Check,
  ChevronDown,
} from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useActions } from '../../lib/actions';
import { useBackend, perform } from '../../lib/query';
import { invoke, normalizeError } from '../../lib/ipc';
import { useTabs } from '../../stores/tabs';
import type { Status } from '../../lib/types';
import { Button } from '../shared/Button';
import { CheckBox } from '../shared/CheckBox';
import { Modal } from '../shared/Modal';
import { VirtualList } from '../shared/VirtualList';
import { field } from '../shared/styles';
import { openCompare } from '../sidebar/CompareSection';
export async function checkout(repo: string, name: string) {
  useTabs.getState().setBusy(1);
  useTabs.getState().setError(null);
  try {
    await invoke('branch_switch', { repo, name });
  } catch (error) {
    const failure = normalizeError(error);
    if (
      failure.message.includes('would be overwritten') &&
      (await confirm(
        `${failure.message}\n\nStash your changes, switch, and restore them? GitViewer will return to the original branch if restoration would conflict.`,
        { title: 'Smart checkout', kind: 'warning' },
      ))
    )
      await perform('smart_checkout', { repo, name });
    else useTabs.getState().setError(failure);
  } finally {
    useTabs.getState().setBusy(-1);
  }
}
export function BranchPopover({
  repo,
  status,
  disabled,
}: {
  repo: string;
  status: Status;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [base, setBase] = useState('HEAD');
  const [switchAfter, setSwitchAfter] = useState(true);
  const query = useBackend('branches', { repo }, open || creating);
  const branches =
    query.data?.filter((branch) =>
      branch.name.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];
  const branchRows = [false, true].flatMap((remote) => {
    const group = branches.filter((branch) => branch.remote === remote);
    return group.length
      ? [
          {
            heading: remote ? 'Remote branches' : 'Local branches',
            branch: null,
          },
          ...group.map((branch) => ({ heading: '', branch })),
        ]
      : [];
  });
  useActions(`${repo}:branches`, [
    {
      id: 'branches',
      icon: <GitBranch className="size-3.5" />,
      label: 'Switch branch',
      key: 'Mod+b',
      disabled,
      run: () => setOpen(true),
    },
    {
      id: 'new-branch',
      icon: <Plus className="size-3.5" />,
      label: 'Create branch',
      key: 'Mod+Shift+b',
      disabled,
      run: () => setCreating(true),
    },
    {
      id: 'delete-branch',
      icon: <Trash2 className="size-3.5" />,
      label: 'Choose branch to delete',
      key: 'Mod+Alt+x',
      disabled,
      run: () => setOpen(true),
    },
  ]);
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button className="border border-line bg-surface dark:border-line-dark dark:bg-surface-dark">
            <GitBranch className="size-4" />
            {status.branch === '(detached)'
              ? `${status.oid.slice(0, 7)} · detached`
              : status.branch || 'Branch'}
            <ChevronDown className="size-3" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            className="z-30 flex h-96 w-80 flex-col rounded-md border border-line bg-surface p-2 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
          >
            <div className="flex items-center gap-2 border-b border-line pb-2 dark:border-line-dark">
              <Search className="size-3.5 shrink-0 text-faint dark:text-faint-dark" />
              <TextInput
                aria-label="Filter branches"
                className={field}
                placeholder="Filter branches"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            {query.error && <p role="alert">{query.error.message}</p>}
            <VirtualList
              label="Branches"
              items={branchRows}
              height={28}
              render={({ heading, branch }) =>
                branch ? (
                  <div className="flex h-section items-center">
                    <Button
                      disabled={disabled || branch.current}
                      className="min-w-0 flex-1 justify-start"
                      onClick={() => {
                        setOpen(false);
                        void checkout(repo, branch.name);
                      }}
                    >
                      <Check
                        className={`size-3 ${branch.current ? '' : 'opacity-0'}`}
                      />
                      <span className="truncate">{branch.name}</span>
                      <span className="ml-auto text-label text-muted">
                        {branch.remote ? 'remote' : 'local'}
                      </span>
                    </Button>
                    <Button
                      title={`Compare with ${branch.name}`}
                      disabled={branch.current}
                      onClick={() => {
                        setOpen(false);
                        openCompare(repo, {
                          compareBase: branch.name,
                          compareTarget: status.branch,
                        });
                      }}
                    >
                      <GitCompare className="size-3 text-muted dark:text-muted-dark" />
                    </Button>
                    <Button
                      title={`Delete ${branch.name}`}
                      disabled={disabled || branch.current}
                      onClick={() => {
                        void confirm(
                          `Delete ${branch.name}? Unmerged branches will be refused.`,
                          { title: 'Delete branch', kind: 'warning' },
                        ).then((approved) => {
                          if (approved)
                            void perform('branch_delete', {
                              repo,
                              name: branch.name,
                            });
                        });
                      }}
                    >
                      <Trash2 className="size-3 text-deleted dark:text-deleted-dark" />
                    </Button>
                  </div>
                ) : (
                  <h3 className="flex h-group items-center px-2 text-label font-semibold tracking-wider text-faint uppercase dark:text-faint-dark">
                    {heading}
                  </h3>
                )
              }
            />
            <div className="mt-2 flex gap-1.5 border-t border-line pt-2 dark:border-line-dark">
              <Button
                className="border border-line dark:border-line-dark"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
              >
                <Plus className="size-3" />
                New branch
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Modal title="New branch" open={creating} onOpenChange={setCreating}>
        <div className="flex flex-col gap-4">
          <label className="text-xs">
            Name
            <TextInput
              className={field}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="text-xs">
            Based on
            <TextInput
              list="base-references"
              className={field}
              value={base}
              onChange={(event) => setBase(event.target.value)}
            />
            <datalist id="base-references">
              {query.data?.map((branch) => (
                <option key={branch.name} value={branch.name} />
              ))}
            </datalist>
          </label>
          <div className="flex items-center gap-2 text-xs">
            <CheckBox
              label="Switch to it after creating"
              checked={switchAfter}
              onChange={() => setSwitchAfter(!switchAfter)}
            />
            Switch to it after creating
          </div>
          <Button
            className="bg-accent text-white"
            disabled={
              disabled ||
              !name.trim() ||
              !base.trim() ||
              query.data?.some((branch) => branch.name === name)
            }
            onClick={async () => {
              const result = await perform('branch_create', {
                repo,
                name,
                base,
                checkout: false,
              });
              if (result !== undefined) {
                setCreating(false);
                if (switchAfter) await checkout(repo, name);
              }
            }}
          >
            Create branch
          </Button>
        </div>
      </Modal>
    </>
  );
}
