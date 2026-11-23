import { useState } from 'react';
import { useFormState } from '../../lib/form-state';
import { open as choose } from '@tauri-apps/plugin-dialog';
import { baseOrHead, branchRefs, nameProblem } from '../../lib/branch-name';
import { createThenSwitch, type CreateMode } from '../../lib/create';
import { perform, useBackend } from '../../lib/query';
import { switchWorktree } from '../../lib/repository';
import type { WorktreeMode } from '../../lib/types';
import type { Tab } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { Choice } from '../shared/Choice';
import { Select } from '../shared/Select';
import { TextInput } from '../shared/TextInput';
import { field, mutedLabel } from '../shared/styles';
import { FieldError } from '../states/Errors';
import { keysOf } from '../../lib/options';
import {
  BaseBranchSelect,
  BranchNameField,
  branchIcon,
  CreateFooter,
} from './BranchForm';
const kinds = {
  detached: 'detached',
  'new branch': 'new',
  'existing branch': 'existing',
} satisfies Record<string, WorktreeMode>;
type Kind = keyof typeof kinds;
interface WorktreeForm {
  kind: Kind;
  name: string;
  base: string;
  existing: string;
  custom: string | null;
}
const emptyWorktreeForm: WorktreeForm = {
  kind: 'detached',
  name: '',
  base: '',
  existing: '',
  custom: null,
};
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
  const { form, update, reset } = useFormState(emptyWorktreeForm);
  const { kind, name, base, existing, custom } = form;
  const [mode, setMode] = useState<CreateMode>('switch');
  const branches = useBackend('branches', { repo }, open).data ?? [];
  const refs = branchRefs(branches);
  const remote = refs.remote;
  const free = branches.filter((branch) => !branch.remote && !branch.worktree);
  const chosenBase = baseOrHead(base, refs.head);
  const worktreeMode = kinds[kind];
  const reference =
    worktreeMode === 'detached'
      ? chosenBase
      : worktreeMode === 'new'
        ? name
        : existing;
  const target = useBackend(
    'worktree_target',
    { repo: repo, mode: worktreeMode, ref: reference, path: custom ?? '' },
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
    reset();
  };
  const baseSelect = (label: string) => (
    <BaseBranchSelect
      label={label}
      value={chosenBase}
      refs={refs}
      onChange={(next) => update({ base: next })}
    >
      {worktreeMode === 'detached' && target && (
        <p className={mutedLabel}>
          Checks out <span className="font-mono">{target.label}</span> without
          creating a branch.
        </p>
      )}
    </BaseBranchSelect>
  );
  return (
    <Modal
      title="New worktree"
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      footer={
        <CreateFooter
          form="new-worktree-form"
          mode={mode}
          disabled={blocked}
          optionsLabel="Create worktree options"
          onMode={setMode}
          onCancel={close}
        />
      }
    >
      <form
        id="new-worktree-form"
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (blocked) return;
          await createThenSwitch({
            mode: mode,
            create: () =>
              perform('worktree_add', {
                repo: repo,
                path: folder,
                mode: worktreeMode,
                branch: worktreeMode === 'new' ? name : existing,
                base: chosenBase,
              }),
            finish: close,
            switchTo: async (created) => {
              if (project) await switchWorktree(project, created);
            },
          });
        }}
      >
        <Choice
          label="Worktree branch"
          appearance="radio"
          value={kind}
          options={keysOf(kinds)}
          onChange={(next) => update({ kind: next, custom: null })}
        />
        {worktreeMode === 'detached' && baseSelect('Start from')}
        {worktreeMode === 'new' && (
          <>
            <BranchNameField
              id="new-worktree-branch"
              hintId="new-worktree-branch-hint"
              label="Branch name"
              value={name}
              problem={problem}
              onChange={(next) => update({ name: next })}
            />
            {baseSelect('Based on')}
          </>
        )}
        {worktreeMode === 'existing' && (
          <div className="flex flex-col gap-1 text-sm">
            <span>Branch</span>
            <Select
              label="Branch"
              placeholder="Choose a branch"
              icon={branchIcon}
              mono
              value={existing}
              groups={[
                { label: 'Local', options: free.map((branch) => branch.name) },
                { label: 'Remote', options: remote },
              ].filter((group) => group.options.length)}
              badges={Object.fromEntries(
                remote.map((branch) => [branch, 'remote']),
              )}
              onChange={(next) => update({ existing: next, custom: null })}
            />
            {tracked && (
              <p className={mutedLabel}>
                Creates <span className="font-mono">{tracked}</span> tracking
                it.
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="new-worktree-folder">Folder</label>
          <div className="flex gap-2">
            <TextInput
              id="new-worktree-folder"
              aria-invalid={taken}
              aria-describedby="new-worktree-folder-hint"
              className={`${field} h-8 min-w-0 flex-1 font-mono text-diff`}
              value={folder}
              onChange={(event) => update({ custom: event.target.value })}
            />
            <Button
              variant="standard"
              className="h-8"
              onClick={async () => {
                const chosen = await choose({
                  directory: true,
                  multiple: false,
                  title: 'Choose worktree folder',
                });
                if (typeof chosen === 'string') update({ custom: chosen });
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
              <p className={mutedLabel}>
                Ignored files such as{' '}
                <span className="font-mono">node_modules</span> and{' '}
                <span className="font-mono">.env</span> are not copied.
              </p>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
