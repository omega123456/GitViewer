import { TextInput } from '../shared/TextInput';
import { useState } from 'react';
import { DropdownMenu, Popover } from 'radix-ui';
import {
  GitBranch,
  GitCompare,
  GitMerge,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Check,
  ChevronDown,
} from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useActions } from '../../lib/actions';
import { attempt, useBackend, perform } from '../../lib/query';
import { normalizeError } from '../../lib/ipc';
import { overwrittenPaths } from '../../lib/failure';
import { runs, useCurrentActivity } from '../../stores/activity';
import { ask } from '../../stores/decision';
import { useErrors } from '../../stores/errors';
import type { Branch, Status } from '../../lib/types';
import { Button } from '../shared/Button';
import { Decision } from '../shared/Decision';
import { ErrorRow, FieldError } from '../states/Errors';
import { Modal } from '../shared/Modal';
import { Select } from '../shared/Select';
import { Spinner } from '../shared/Spinner';
import { VirtualList } from '../shared/VirtualList';
import { dynamic, field, focus } from '../shared/styles';
import { openCompare } from '../sidebar/CompareSection';
import { mergeBranch } from '../../lib/merge';
const item = `flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs outline-none data-disabled:opacity-40 data-highlighted:bg-hover dark:data-highlighted:bg-hover-dark ${focus}`;
const branchCommands = [
  'branch_switch',
  'smart_checkout',
  'branch_create',
  'branch_delete',
  'branch_merge',
] as const;
const createModes = { switch: 'Create & switch', stay: 'Create only' };
type CreateMode = keyof typeof createModes;
const invalidRef =
  /[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-./]|\/\.|[./]$|\.lock(\/|$)|^@$/;
function nameProblem(name: string, branches: Branch[]) {
  if (branches.some((branch) => branch.name === name))
    return `A branch named “${name}” already exists.`;
  if (invalidRef.test(name))
    return 'Not a valid branch name. Avoid ~ ^ : ? * [ \\ @{ and .., a leading - . or /, and a trailing . / or .lock.';
  return null;
}
export async function checkout(repo: string, name: string) {
  try {
    await attempt('branch_switch', { repo, name });
    useErrors.getState().resolve(repo, 'branch_switch');
  } catch (error) {
    const failure = normalizeError(error);
    const paths = overwrittenPaths(failure.message);
    if (
      failure.message.includes('would be overwritten') &&
      (await ask(repo, {
        slot: 'branch',
        title: `Switch to ${name}?`,
        body: paths.length
          ? 'Your changes to these files would be overwritten:'
          : 'Your local changes would be overwritten.',
        paths,
        note: 'GitViewer stashes them, switches, and restores them. If they conflict, it returns to the original branch.',
        confirm: 'Stash and switch',
      }))
    )
      await perform('smart_checkout', { repo, name });
    else
      useErrors.getState().report(repo, failure, { command: 'branch_switch' });
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
  const activity = useCurrentActivity(repo);
  const switching = branchCommands.some((command) => runs(activity, command));
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [base, setBase] = useState('');
  const [mode, setMode] = useState<CreateMode>('switch');
  const query = useBackend('branches', { repo }, open || creating);
  const all = query.data ?? [];
  const head = all.find((branch) => branch.current)?.name;
  const local = all.filter((branch) => !branch.remote).map((b) => b.name);
  const remote = all.filter((branch) => branch.remote).map((b) => b.name);
  const chosenBase = base || head || 'HEAD';
  const problem = name ? nameProblem(name, all) : null;
  const blocked = disabled || !name || Boolean(problem);
  const branches =
    query.data?.filter((branch) =>
      branch.name.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];
  const longest = (query.data ?? []).reduce(
    (widest, branch) => Math.max(widest, branch.name.length),
    0,
  );
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
      id: 'merge-branch',
      icon: <GitMerge className="size-3.5" />,
      label: 'Merge a branch',
      key: 'Mod+Alt+m',
      disabled,
      run: () => setOpen(true),
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
        <span className="relative flex">
          <Popover.Trigger asChild>
            <Button
              aria-busy={switching}
              className="border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
            >
              {switching ? <Spinner /> : <GitBranch className="size-4" />}
              {status.branch === '(detached)'
                ? `${status.oid.slice(0, 7)} · detached`
                : status.branch || 'Branch'}
              <ChevronDown className="size-3" />
            </Button>
          </Popover.Trigger>
          <Decision repo={repo} slot="branch" className="inset-0" />
        </span>
        <Popover.Portal>
          <Popover.Content
            align="start"
            style={dynamic({
              '--branches-width': `clamp(320px, min(calc(${longest}ch + 150px), var(--radix-popover-content-available-width, 640px)), 640px)`,
            })}
            className="z-30 flex h-96 w-branches flex-col rounded-md border border-line bg-surface p-2 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
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
            {query.error && (
              <ErrorRow
                label="Could not load branches"
                error={query.error}
                retry={() => void query.refetch()}
              />
            )}
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
                    <DropdownMenu.Root modal={false}>
                      <DropdownMenu.Trigger asChild>
                        <Button aria-label={`Actions for ${branch.name}`}>
                          <MoreHorizontal className="size-3 text-muted dark:text-muted-dark" />
                        </Button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="end"
                          sideOffset={4}
                          className="z-40 flex w-52 flex-col rounded-md border border-line bg-surface p-1 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
                        >
                          <DropdownMenu.Item
                            disabled={disabled || branch.current}
                            className={item}
                            onSelect={() => {
                              setOpen(false);
                              void mergeBranch(
                                repo,
                                branch.name,
                                status.branch,
                              );
                            }}
                          >
                            <GitMerge className="size-3" />
                            Merge into {status.branch}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            disabled={branch.current}
                            className={item}
                            onSelect={() => {
                              setOpen(false);
                              openCompare(repo, {
                                compareBase: branch.name,
                                compareTarget: status.branch,
                              });
                            }}
                          >
                            <GitCompare className="size-3" />
                            Compare with {status.branch}
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator className="my-1 h-px bg-line dark:bg-line-dark" />
                          <DropdownMenu.Item
                            disabled={disabled || branch.current}
                            className={`${item} text-deleted dark:text-deleted-dark`}
                            onSelect={() => {
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
                            <Trash2 className="size-3" />
                            Delete branch
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
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
      <Modal
        title="New branch"
        focusId="new-branch-name"
        open={creating}
        onOpenChange={setCreating}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (blocked) return;
            const result = await perform('branch_create', {
              repo,
              name,
              base: chosenBase,
              checkout: false,
            });
            if (result === undefined) return;
            setCreating(false);
            setName('');
            setBase('');
            if (mode === 'switch') await checkout(repo, name);
          }}
        >
          <div className="flex flex-col gap-1 text-xs">
            <label htmlFor="new-branch-name">Name</label>
            <TextInput
              id="new-branch-name"
              aria-invalid={Boolean(problem)}
              aria-describedby="new-branch-hint"
              className={`${field} h-7 font-mono text-xs`}
              placeholder="feature/short-description"
              value={name}
              onChange={(event) =>
                setName(event.target.value.replace(/\s+/g, '-'))
              }
            />
            <div id="new-branch-hint">
              {problem ? (
                <FieldError>{problem}</FieldError>
              ) : (
                <p className="text-label text-muted dark:text-muted-dark">
                  Spaces become dashes.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-xs">
            <span>Based on</span>
            <Select
              label="Based on"
              placeholder="Current branch"
              icon={
                <GitBranch className="size-3.5 shrink-0 text-muted dark:text-muted-dark" />
              }
              value={chosenBase}
              groups={[
                { label: 'Local', options: head ? local : ['HEAD', ...local] },
                { label: 'Remote', options: remote },
              ].filter((group) => group.options.length)}
              badges={head ? { [head]: 'current' } : { HEAD: 'detached' }}
              onChange={setBase}
            />
          </div>
          <div className="flex justify-end gap-1.5 border-t border-line pt-4 dark:border-line-dark">
            <Button
              className="h-7 px-3 font-medium text-muted dark:text-muted-dark"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <div className="flex">
              <Button
                type="submit"
                variant="primary"
                disabled={blocked}
                className="h-7 rounded-r-none px-3 font-medium"
              >
                {createModes[mode]}
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="primary"
                    disabled={blocked}
                    aria-label="Create options"
                    className="h-7 rounded-l-none border-l border-white/30 dark:border-surface-dark/30"
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-50 flex w-40 flex-col rounded-md border border-line bg-surface p-1 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
                  >
                    <DropdownMenu.RadioGroup
                      value={mode}
                      onValueChange={(value) => setMode(value as CreateMode)}
                    >
                      {(Object.keys(createModes) as CreateMode[]).map(
                        (option) => (
                          <DropdownMenu.RadioItem
                            key={option}
                            value={option}
                            className={item}
                          >
                            <span className="flex size-3 items-center justify-center">
                              <DropdownMenu.ItemIndicator>
                                <Check className="size-3" />
                              </DropdownMenu.ItemIndicator>
                            </span>
                            {createModes[option]}
                          </DropdownMenu.RadioItem>
                        ),
                      )}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
