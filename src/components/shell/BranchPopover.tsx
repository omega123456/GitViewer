import { TextInput } from '../shared/TextInput';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DropdownMenu, Popover } from 'radix-ui';
import {
  ArrowRightFromLine,
  Eraser,
  FolderPlus,
  FolderGit2,
  FolderSymlink,
  GitBranch,
  GitCompare,
  GitMerge,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Check,
  ChevronDown,
  TriangleAlert,
} from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useActions } from '../../lib/actions';
import {
  attempt,
  client,
  perform,
  queryKey,
  useBackend,
  useStatuses,
} from '../../lib/query';
import { switchWorktree } from '../../lib/repository';
import { applyWorktree, deleteWorktree } from '../../lib/worktree';
import { invoke, normalizeError } from '../../lib/ipc';
import { overwrittenPaths } from '../../lib/failure';
import { runs, useCurrentActivity } from '../../stores/activity';
import { ask } from '../../stores/decision';
import { useErrors } from '../../stores/errors';
import type {
  Branch,
  SettingsResponse,
  Status,
  Worktree,
} from '../../lib/types';
import { anchorOf, useProject, type Tab } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { CreateButton, type CreateMode } from '../shared/CreateButton';
import { Decision } from '../shared/Decision';
import { ErrorRow, FieldError } from '../states/Errors';
import { Modal } from '../shared/Modal';
import { Select } from '../shared/Select';
import { Spinner } from '../shared/Spinner';
import { VirtualList } from '../shared/VirtualList';
import {
  dynamic,
  field,
  flyout,
  menu,
  menuItem,
  menuSeparator,
  searchBox,
  searchInput,
} from '../shared/styles';
import { openCompare } from '../sidebar/CompareSection';
import { mergeBranch } from '../../lib/merge';
import { pruneBranches } from '../../lib/prune';
import { NewWorktree } from './NewWorktree';
import { nameProblem } from '../../lib/branch-name';
type Row =
  | { kind: 'heading'; heading: string }
  | { kind: 'worktree'; worktree: Worktree }
  | { kind: 'branch'; branch: Branch };
function headLabel(detached: boolean, oid: string, branch: string) {
  return detached ? `${oid.slice(0, 7)} detached` : branch;
}
function WorktreeIcon({ worktree }: { worktree: Worktree }) {
  const Icon = worktree.main ? FolderGit2 : FolderSymlink;
  return <Icon className="size-3 shrink-0 text-muted dark:text-muted-dark" />;
}
function Marker({
  worktree,
  status,
  busy,
}: {
  worktree: Worktree;
  status?: Status;
  busy?: string;
}) {
  const running = Boolean(useCurrentActivity(worktree.id));
  const failed = useErrors((s) => Boolean(s.scopes[worktree.id]?.length));
  const count = status?.entries.length ?? 0;
  if (busy) return busy;
  if (running)
    return (
      <span role="img" aria-label="Git operation running">
        <Spinner className="size-3 text-accent dark:text-accent-dark" />
      </span>
    );
  if (worktree.missing)
    return (
      <>
        missing
        <TriangleAlert
          role="img"
          aria-label="Folder missing"
          className="size-3"
        />
      </>
    );
  if (failed)
    return (
      <span
        role="img"
        aria-label="Errors waiting"
        className="size-1.5 rounded-full bg-error-ink dark:bg-error-ink-dark"
      />
    );
  if (count)
    return (
      <>
        <span
          role="img"
          aria-label="Uncommitted changes"
          className="size-2 rounded-full bg-modified dark:bg-modified-dark"
        />
        <span className="font-mono">{count}</span>
      </>
    );
  if (worktree.locked !== null)
    return (
      <span title={worktree.locked || 'Locked'}>
        <Lock role="img" aria-label="Locked" className="size-3" />
      </span>
    );
  return null;
}
function WorktreeMenu({
  worktree,
  view,
  project,
  main,
  changes,
  disabled,
  onPick,
}: {
  worktree: Worktree;
  view: string;
  project: Tab;
  main?: Worktree;
  changes: number;
  disabled: boolean;
  onPick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const target = main?.id ?? '';
  const summary = useBackend(
    'worktree_summary',
    { repo: worktree.id, target },
    open && Boolean(main) && !worktree.missing,
  ).data;
  const own = useCurrentActivity(worktree.id);
  const mainActivity = useCurrentActivity(target);
  const busy = Boolean(own || mainActivity);
  const empty = Boolean(summary && !summary.ahead && !changes);
  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <Button aria-label={`Actions for ${worktree.name}`} disabled={disabled}>
          <MoreHorizontal className="size-3 text-muted dark:text-muted-dark" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className={`w-60 ${menu}`}
        >
          {main && !worktree.missing && (
            <>
              <DropdownMenu.Item
                disabled={busy || empty}
                title={`Apply all changes to ${main.name} on ${main.branch}`}
                className={menuItem}
                onSelect={() => {
                  onPick();
                  void applyWorktree(view, worktree, target);
                }}
              >
                <ArrowRightFromLine className="size-3" />
                Apply to main checkout
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={menuSeparator} />
            </>
          )}
          <DropdownMenu.Item
            disabled={busy}
            className={`${menuItem} text-deleted dark:text-deleted-dark`}
            onSelect={() => {
              onPick();
              void deleteWorktree(project, worktree, changes);
            }}
          >
            <Trash2 className="size-3" />
            Delete worktree…
          </DropdownMenu.Item>
          {empty && (
            <p className="px-3.5 pb-1 pl-10.5 text-label text-muted dark:text-muted-dark">
              No changes since it split from main
            </p>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
const branchCommands = [
  'branch_switch',
  'smart_checkout',
  'branch_create',
  'branch_delete',
  'branch_gone',
  'branch_prune',
  'branch_merge',
  'worktree_apply',
  'worktree_unapply',
  'worktree_remove',
] as const;
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
    ) {
      if ((await perform('smart_checkout', { repo, name })) === undefined)
        return;
    } else {
      useErrors.getState().report(repo, failure, { command: 'branch_switch' });
      return;
    }
  }
  await pullOnCheckout(repo);
}
async function pullOnCheckout(repo: string) {
  const settings = client.getQueryData<SettingsResponse>(
    queryKey('settings_get', {}),
  );
  if (!settings?.pullOnCheckout) return;
  const status = await client.fetchQuery({
    queryKey: queryKey('status', { repo }),
    queryFn: () => invoke('status', { repo }),
    staleTime: 0,
  });
  if (status.upstream) await perform('sync', { repo, action: 'pull' });
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
  const pressedInside = useRef(false);
  useEffect(() => {
    if (!open) return;
    pressedInside.current = false;
    const dismiss = () => {
      if (!pressedInside.current) setOpen(false);
      pressedInside.current = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const markPressedInside = () => {
    pressedInside.current = true;
  };
  const project = useProject(repo);
  const members = project?.members ?? [repo];
  const anchor = project ? anchorOf(project) : repo;
  const worktreeQuery = useBackend('worktrees', { repo: anchor });
  const worktrees = worktreeQuery.data ?? [];
  const linked = worktrees.length > 1;
  const current = worktrees.find((worktree) => worktree.id === repo);
  const statuses = useStatuses(members);
  const othersFailed = useErrors((s) =>
    members.some((member) => member !== repo && s.scopes[member]?.length),
  );
  const othersDirty = members.some(
    (member) => member !== repo && statuses[member]?.entries.length,
  );
  const go = (worktree: Worktree) => {
    flushSync(() => setOpen(false));
    if (project) void switchWorktree(project, worktree.id);
  };
  const activity = useCurrentActivity(repo);
  const switching = branchCommands.some((command) => runs(activity, command));
  const checking = runs(activity, 'branch_gone');
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const main = worktrees.find((worktree) => worktree.main && !worktree.bare);
  const changesIn = (id: string) => statuses[id]?.entries.length ?? 0;
  const present = worktrees.filter(
    (worktree) => !worktree.main && !worktree.missing && !worktree.bare,
  );
  const [name, setName] = useState('');
  const [base, setBase] = useState('');
  const [mode, setMode] = useState<CreateMode>('switch');
  const query = useBackend('branches', { repo }, open || creating);
  const all = query.data ?? [];
  const head = all.find((branch) => branch.current)?.name;
  const local = all.filter((branch) => !branch.remote).map((b) => b.name);
  const remote = all.filter((branch) => branch.remote).map((b) => b.name);
  const tracked = all.some((branch) => !branch.remote && branch.upstream);
  const chosenBase = base || head || 'HEAD';
  const problem = name ? nameProblem(name, all) : null;
  const blocked = disabled || !name || Boolean(problem);
  const branches =
    query.data?.filter((branch) =>
      branch.name.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];
  const longest = [
    ...(query.data ?? []).map((branch) => branch.name.length),
    ...worktrees.map((w) => w.name.length + w.branch.length + 2),
  ].reduce((widest, length) => Math.max(widest, length), 0);
  const shownWorktrees = linked
    ? worktrees.filter((worktree) =>
        `${worktree.name} ${worktree.branch}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : [];
  const rows: Row[] = [
    ...(shownWorktrees.length
      ? [
          { kind: 'heading' as const, heading: 'Worktrees' },
          ...shownWorktrees.map((worktree) => ({
            kind: 'worktree' as const,
            worktree,
          })),
        ]
      : []),
    ...[false, true].flatMap((remote) => {
      const group = branches.filter((branch) => branch.remote === remote);
      return group.length
        ? [
            {
              kind: 'heading' as const,
              heading: remote ? 'Remote branches' : 'Local branches',
            },
            ...group.map((branch) => ({ kind: 'branch' as const, branch })),
          ]
        : [];
    }),
  ];
  const holderOf = (branch: Branch) =>
    branch.worktree && branch.worktree !== repo
      ? worktrees.find((worktree) => worktree.id === branch.worktree)
      : undefined;
  const filterLabel = linked
    ? 'Filter worktrees and branches'
    : 'Filter branches';
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
    {
      id: 'prune-branches',
      icon: <Eraser className="size-3.5" />,
      label: 'Prune local branches',
      key: '',
      disabled,
      run: () => void pruneBranches(repo, status.branch),
    },
    {
      id: 'new-worktree',
      icon: <FolderPlus className="size-3.5" />,
      label: 'Create worktree…',
      key: '',
      disabled,
      run: () => setCreatingWorktree(true),
    },
  ]);
  useActions(
    `${repo}:worktrees`,
    linked
      ? [
          {
            id: 'worktrees',
            icon: <FolderSymlink className="size-3.5" />,
            label: 'Switch worktree…',
            key: '',
            run: () => setOpen(true),
          },
          ...worktrees
            .filter(
              (worktree) =>
                worktree.id !== repo && !worktree.missing && !worktree.bare,
            )
            .map((worktree) => ({
              id: `worktree:${worktree.id}`,
              icon: <FolderSymlink className="size-3.5" />,
              label: `Switch to worktree ${worktree.name}`,
              key: '',
              run: () => go(worktree),
            })),
          ...(main
            ? present.map((worktree) => ({
                id: `apply:${worktree.id}`,
                icon: <ArrowRightFromLine className="size-3.5" />,
                label: `Apply worktree ${worktree.name} to main`,
                key: '',
                run: () => void applyWorktree(repo, worktree, main.id),
              }))
            : []),
          ...(project && current && present.includes(current)
            ? [
                {
                  id: 'delete-worktree',
                  icon: <Trash2 className="size-3.5" />,
                  label: 'Delete worktree…',
                  key: '',
                  run: () =>
                    void deleteWorktree(project, current, changesIn(repo)),
                },
              ]
            : []),
        ]
      : [],
  );
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <span
          className="relative flex"
          onPointerDownCapture={markPressedInside}
        >
          <Popover.Trigger asChild>
            <Button aria-busy={switching} variant="standard" className="h-8">
              {linked && current && (
                <>
                  {current.main ? (
                    <FolderGit2 className="size-4 text-muted dark:text-muted-dark" />
                  ) : (
                    <FolderSymlink className="size-4 text-muted dark:text-muted-dark" />
                  )}
                  <span className="max-w-28 truncate">{current.name}</span>
                  <span className="text-muted dark:text-muted-dark">/</span>
                </>
              )}
              {switching ? <Spinner /> : <GitBranch className="size-4" />}
              {status.branch === '(detached)'
                ? `${status.oid.slice(0, 7)} · detached`
                : status.branch || 'Branch'}
              <ChevronDown className="size-3 text-muted dark:text-muted-dark" />
            </Button>
          </Popover.Trigger>
          {linked && (othersFailed || othersDirty) && (
            <span
              role="img"
              aria-label={
                othersFailed
                  ? 'Errors waiting in another worktree'
                  : 'Another worktree has uncommitted changes'
              }
              className={`pointer-events-none absolute -top-0.5 -right-0.5 size-1.5 rounded-full ${othersFailed ? 'bg-error-ink dark:bg-error-ink-dark' : 'bg-modified dark:bg-modified-dark'}`}
            />
          )}
          <Decision repo={repo} slot="branch" className="inset-0" />
        </span>
        <Popover.Portal>
          <Popover.Content
            onPointerDownCapture={markPressedInside}
            align="start"
            style={dynamic({
              '--branches-width': `clamp(320px, min(calc(${longest}ch + 150px), var(--radix-popover-content-available-width, 640px)), 640px)`,
            })}
            className={`z-30 flex h-96 w-branches flex-col p-2 ${flyout}`}
          >
            <label className={`mb-2 h-7 ${searchBox}`}>
              <Search className="size-3.5 shrink-0 text-muted dark:text-muted-dark" />
              <TextInput
                aria-label={filterLabel}
                className={searchInput}
                placeholder={filterLabel}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            {query.error && (
              <ErrorRow
                label="Could not load branches"
                error={query.error}
                retry={() => void query.refetch()}
              />
            )}
            <VirtualList
              label="Branches"
              items={rows}
              height={30}
              render={(row) => {
                if (row.kind === 'heading')
                  return (
                    <div className="flex h-group items-center gap-2 px-2">
                      <h3 className="flex-1 text-label font-semibold text-muted dark:text-muted-dark">
                        {row.heading}
                      </h3>
                      {row.heading === 'Local branches' && tracked && (
                        <Button
                          title="Check the remote and delete local branches whose remote branch was deleted"
                          aria-busy={checking}
                          disabled={disabled || switching}
                          className="h-5 text-label text-muted hover:text-ink dark:text-muted-dark dark:hover:text-ink-dark"
                          onClick={() =>
                            void pruneBranches(repo, status.branch)
                          }
                        >
                          {checking ? (
                            <Spinner className="size-3" />
                          ) : (
                            <Eraser className="size-3" />
                          )}
                          {checking ? 'Checking remote…' : 'Prune'}
                        </Button>
                      )}
                    </div>
                  );
                if (row.kind === 'worktree') {
                  const { worktree } = row;
                  const status = statuses[worktree.id];
                  const busy = runs(activity, 'worktree_remove', {
                    worktree: worktree.id,
                  })
                    ? 'Deleting…'
                    : runs(activity, 'worktree_apply', { source: worktree.id })
                      ? 'Applying…'
                      : undefined;
                  return (
                    <div className="flex h-section items-center">
                      <Button
                        title={worktree.id}
                        disabled={
                          worktree.id === repo ||
                          worktree.missing ||
                          worktree.bare ||
                          Boolean(busy)
                        }
                        className="min-w-0 flex-1 justify-start"
                        onClick={() => go(worktree)}
                      >
                        <Check
                          className={`size-3 shrink-0 ${worktree.id === repo ? '' : 'opacity-0'}`}
                        />
                        <WorktreeIcon worktree={worktree} />
                        <span className="truncate">{worktree.name}</span>
                        <span className="truncate font-mono text-badge text-muted dark:text-muted-dark">
                          {worktree.bare
                            ? 'bare'
                            : status
                              ? headLabel(
                                  status.branch === '(detached)',
                                  status.oid,
                                  status.branch,
                                )
                              : headLabel(
                                  worktree.detached,
                                  worktree.oid,
                                  worktree.branch,
                                )}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-label text-muted dark:text-muted-dark">
                          <Marker
                            worktree={worktree}
                            status={status}
                            busy={busy}
                          />
                        </span>
                      </Button>
                      {project &&
                      (present.includes(worktree) ||
                        (worktree.missing && !worktree.main)) ? (
                        <WorktreeMenu
                          worktree={worktree}
                          view={repo}
                          project={project}
                          main={main}
                          changes={changesIn(worktree.id)}
                          disabled={Boolean(busy)}
                          onPick={() => setOpen(false)}
                        />
                      ) : (
                        <span aria-hidden className="w-7 shrink-0" />
                      )}
                    </div>
                  );
                }
                const { branch } = row;
                const holder = holderOf(branch);
                return (
                  <div className="flex h-section items-center">
                    <Button
                      disabled={
                        disabled || branch.current || Boolean(holder?.missing)
                      }
                      className="min-w-0 flex-1 justify-start"
                      onClick={() => {
                        if (holder) go(holder);
                        else {
                          setOpen(false);
                          void checkout(repo, branch.name);
                        }
                      }}
                    >
                      <Check
                        className={`size-3 ${branch.current ? '' : 'opacity-0'}`}
                      />
                      <span className="truncate">{branch.name}</span>
                      <span className="ml-auto flex items-center gap-1.5 text-label text-muted">
                        {holder ? (
                          <>
                            in {holder.name}
                            <WorktreeIcon worktree={holder} />
                          </>
                        ) : branch.remote ? (
                          'remote'
                        ) : branch.gone ? (
                          <span className="text-merge-ink dark:text-merge-ink-dark">
                            remote deleted
                          </span>
                        ) : (
                          'local'
                        )}
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
                          className={`w-60 ${menu}`}
                        >
                          <DropdownMenu.Item
                            disabled={disabled || branch.current}
                            className={menuItem}
                            title={`Merge into ${status.branch}`}
                            onSelect={() => {
                              setOpen(false);
                              void mergeBranch(
                                repo,
                                branch.name,
                                status.branch,
                              );
                            }}
                          >
                            <GitMerge className="size-3 shrink-0" />
                            <span className="truncate">
                              Merge into {status.branch}
                            </span>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            disabled={branch.current}
                            className={menuItem}
                            title={`Compare with ${status.branch}`}
                            onSelect={() => {
                              setOpen(false);
                              openCompare(repo, {
                                compareBase: branch.name,
                                compareTarget: status.branch,
                              });
                            }}
                          >
                            <GitCompare className="size-3 shrink-0" />
                            <span className="truncate">
                              Compare with {status.branch}
                            </span>
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator className={menuSeparator} />
                          <DropdownMenu.Item
                            disabled={
                              disabled || branch.current || Boolean(holder)
                            }
                            className={`${menuItem} text-deleted dark:text-deleted-dark`}
                            onSelect={() => {
                              void confirm(
                                branch.remote
                                  ? `Delete ${branch.name}? Unmerged branches will be refused.`
                                  : `Delete ${branch.name}? Unmerged commits will be lost.`,
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
                            <Trash2 className="size-3 shrink-0" />
                            Delete branch
                          </DropdownMenu.Item>
                          {holder && (
                            <p className="px-3.5 pb-1 pl-10.5 text-label text-muted dark:text-muted-dark">
                              Checked out in {holder.name}
                            </p>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                );
              }}
            />
            <div className="mt-2 flex gap-1.5 border-t border-line pt-2 dark:border-line-dark">
              <Button
                variant="standard"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
              >
                <Plus className="size-3" />
                New branch
              </Button>
              <Button
                variant="standard"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  setCreatingWorktree(true);
                }}
              >
                <FolderPlus className="size-3" />
                New worktree
              </Button>
              {worktrees.some((worktree) => worktree.prunable) && (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void perform('worktree_prune', { repo: anchor })
                  }
                >
                  <Eraser className="size-3" />
                  Prune missing
                </Button>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Modal
        title="New branch"
        focusId="new-branch-name"
        open={creating}
        onOpenChange={setCreating}
        footer={
          <>
            <CreateButton
              form="new-branch-form"
              mode={mode}
              disabled={blocked}
              optionsLabel="Create options"
              onMode={setMode}
            />
            <Button
              variant="standard"
              className="h-8"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </>
        }
      >
        <form
          id="new-branch-form"
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
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="new-branch-name">Name</label>
            <TextInput
              id="new-branch-name"
              aria-invalid={Boolean(problem)}
              aria-describedby="new-branch-hint"
              className={`${field} h-8 font-mono text-diff`}
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
          <div className="flex flex-col gap-1 text-sm">
            <span>Based on</span>
            <Select
              label="Based on"
              placeholder="Current branch"
              icon={
                <GitBranch className="size-3.5 shrink-0 text-muted dark:text-muted-dark" />
              }
              mono
              value={chosenBase}
              groups={[
                { label: 'Local', options: head ? local : ['HEAD', ...local] },
                { label: 'Remote', options: remote },
              ].filter((group) => group.options.length)}
              badges={head ? { [head]: 'current' } : { HEAD: 'detached' }}
              onChange={setBase}
            />
          </div>
        </form>
      </Modal>
      <NewWorktree
        repo={repo}
        project={project}
        open={creatingWorktree}
        disabled={disabled}
        onOpenChange={setCreatingWorktree}
      />
    </>
  );
}
