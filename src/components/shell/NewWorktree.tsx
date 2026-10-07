import { useState } from 'react';
import { open as choose } from '@tauri-apps/plugin-dialog';
import { GitBranch } from 'lucide-react';
import { nameProblem } from '../../lib/branch-name';
import { perform, useBackend } from '../../lib/query';
import { switchWorktree } from '../../lib/repository';
import type { WorktreeMode } from '../../lib/types';
import type { Tab } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { CreateButton, type CreateMode } from '../shared/CreateButton';
import { Modal } from '../shared/Modal';
import { Segment } from '../shared/Segment';
import { Select } from '../shared/Select';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import { FieldError } from '../states/Errors';
const kinds = {
  detached: 'detached',
  'new branch': 'new',
  'existing branch': 'existing',
} satisfies Record<string, WorktreeMode>;
type Kind = keyof typeof kinds;
const hint = 'text-label text-muted dark:text-muted-dark';
export function NewWorktree({
  repo,
  project,
  open,
  disabled,
  onOpenChange,
}: {
  repo: string;
  project?: Tab;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<Kind>('detached');
  const [name, setName] = useState('');
  const [base, setBase] = useState('');
  const [existing, setExisting] = useState('');
  const [custom, setCustom] = useState<string | null>(null);
  const [mode, setMode] = useState<CreateMode>('switch');
  const branches = useBackend('branches', { repo }, open).data ?? [];
  const head = branches.find((branch) => branch.current)?.name;
  const local = branches.filter((b) => !b.remote).map((b) => b.name);
  const remote = branches.filter((b) => b.remote).map((b) => b.name);
  const free = branches.filter((b) => !b.remote && !b.worktree);
  const chosenBase = base || head || 'HEAD';
  const worktreeMode = kinds[kind];
  const reference =
    worktreeMode === 'detached'
      ? chosenBase
      : worktreeMode === 'new'
        ? name
        : existing;
  const target = useBackend(
    'worktree_target',
    { repo, mode: worktreeMode, ref: reference, path: custom ?? '' },
    open && (worktreeMode !== 'existing' || Boolean(existing)),
  ).data;
  const folder = custom ?? target?.path ?? '';
  const taken = Boolean(custom && target && !target.free);
  const problem =
    worktreeMode === 'new' && name ? nameProblem(name, branches) : null;
  const blocked =
    disabled ||
    !folder ||
    taken ||
    (worktreeMode === 'new' && (!name || Boolean(problem))) ||
    (worktreeMode === 'existing' && !existing);
  const tracked = remote.includes(existing)
    ? existing.slice(existing.indexOf('/') + 1)
    : '';
  const close = () => {
    onOpenChange(false);
    setKind('detached');
    setName('');
    setBase('');
    setExisting('');
    setCustom(null);
  };
  const startOptions = [
    { label: 'Local', options: head ? local : ['HEAD', ...local] },
    { label: 'Remote', options: remote },
  ].filter((group) => group.options.length);
  const baseSelect = (label: string) => (
    <div className="flex flex-col gap-1 text-xs">
      <span>{label}</span>
      <Select
        label={label}
        placeholder="Current branch"
        icon={
          <GitBranch className="size-3.5 shrink-0 text-muted dark:text-muted-dark" />
        }
        value={chosenBase}
        groups={startOptions}
        badges={head ? { [head]: 'current' } : { HEAD: 'detached' }}
        onChange={setBase}
      />
      {worktreeMode === 'detached' && target && (
        <p className={hint}>
          Checks out <span className="font-mono">{target.label}</span> without
          creating a branch.
        </p>
      )}
    </div>
  );
  return (
    <Modal
      title="New worktree"
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (blocked) return;
          const created = await perform('worktree_add', {
            repo,
            path: folder,
            mode: worktreeMode,
            branch: worktreeMode === 'new' ? name : existing,
            base: chosenBase,
          });
          if (created === undefined) return;
          close();
          if (mode === 'switch' && project)
            await switchWorktree(project, created);
        }}
      >
        <Segment
          label="Worktree branch"
          stretch
          value={kind}
          options={Object.keys(kinds) as Kind[]}
          onChange={(next) => {
            setKind(next);
            setCustom(null);
          }}
        />
        {worktreeMode === 'detached' && baseSelect('Start from')}
        {worktreeMode === 'new' && (
          <>
            <div className="flex flex-col gap-1 text-xs">
              <label htmlFor="new-worktree-branch">Branch name</label>
              <TextInput
                id="new-worktree-branch"
                aria-invalid={Boolean(problem)}
                aria-describedby="new-worktree-branch-hint"
                className={`${field} h-7 font-mono text-xs`}
                placeholder="feature/short-description"
                value={name}
                onChange={(event) =>
                  setName(event.target.value.replace(/\s+/g, '-'))
                }
              />
              <div id="new-worktree-branch-hint">
                {problem ? (
                  <FieldError>{problem}</FieldError>
                ) : (
                  <p className={hint}>Spaces become dashes.</p>
                )}
              </div>
            </div>
            {baseSelect('Based on')}
          </>
        )}
        {worktreeMode === 'existing' && (
          <div className="flex flex-col gap-1 text-xs">
            <span>Branch</span>
            <Select
              label="Branch"
              placeholder="Choose a branch"
              icon={
                <GitBranch className="size-3.5 shrink-0 text-muted dark:text-muted-dark" />
              }
              value={existing}
              groups={[
                { label: 'Local', options: free.map((b) => b.name) },
                { label: 'Remote', options: remote },
              ].filter((group) => group.options.length)}
              badges={Object.fromEntries(remote.map((b) => [b, 'remote']))}
              onChange={(next) => {
                setExisting(next);
                setCustom(null);
              }}
            />
            {tracked && (
              <p className={hint}>
                Creates <span className="font-mono">{tracked}</span> tracking
                it.
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1 text-xs">
          <label htmlFor="new-worktree-folder">Folder</label>
          <div className="flex gap-1.5">
            <TextInput
              id="new-worktree-folder"
              aria-invalid={taken}
              aria-describedby="new-worktree-folder-hint"
              className={`${field} h-7 min-w-0 flex-1 font-mono text-xs`}
              value={folder}
              onChange={(event) => setCustom(event.target.value)}
            />
            <Button
              className="h-7 border border-line px-2.5 dark:border-line-dark"
              onClick={async () => {
                const chosen = await choose({
                  directory: true,
                  multiple: false,
                  title: 'Choose worktree folder',
                });
                if (typeof chosen === 'string') setCustom(chosen);
              }}
            >
              Choose…
            </Button>
          </div>
          <div id="new-worktree-folder-hint">
            {taken ? (
              <FieldError>
                This folder already exists and is not empty.
              </FieldError>
            ) : (
              <p className={hint}>
                Ignored files such as{' '}
                <span className="font-mono">node_modules</span> and{' '}
                <span className="font-mono">.env</span> are not copied.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-1.5 border-t border-line pt-4 dark:border-line-dark">
          <Button
            className="h-7 px-3 font-medium text-muted dark:text-muted-dark"
            onClick={close}
          >
            Cancel
          </Button>
          <CreateButton
            mode={mode}
            disabled={blocked}
            optionsLabel="Create worktree options"
            onMode={setMode}
          />
        </div>
      </form>
    </Modal>
  );
}
