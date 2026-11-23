import { useState } from 'react';
import { useFormState } from '../../lib/form-state';
import { open as choose } from '@tauri-apps/plugin-dialog';
import { baseOrHead, branchRefs, nameProblem } from '../../lib/branch-name';
import { createThenSwitch, type CreateMode } from '../../lib/create';
import { perform, useBackend } from '../../lib/query';
import { switchWorktree } from '../../lib/repository';
import type { WorktreeMode, WorktreeTarget } from '../../lib/types';
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
interface NewWorktreeProps {
  repo: string;
  project?: Tab;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
}
interface ReferenceChoice {
  chosenBase: string;
  name: string;
  existing: string;
}
const referenceOf: Record<WorktreeMode, (choice: ReferenceChoice) => string> = {
  detached: (choice) => choice.chosenBase,
  new: (choice) => choice.name,
  existing: (choice) => choice.existing,
};
function trackedName(remote: string[], existing: string) {
  if (!remote.includes(existing)) return '';
  return existing.slice(existing.indexOf('/') + 1);
}
interface Completeness {
  mode: WorktreeMode;
  name: string;
  existing: string;
  problem: string | null;
}
function missingChoice({ mode, name, existing, problem }: Completeness) {
  const unnamed = !name || Boolean(problem);
  if (mode === 'new') return unnamed;
  if (mode === 'existing') return !existing;
  return false;
}
function needsTarget(mode: WorktreeMode, existing: string) {
  return mode !== 'existing' || Boolean(existing);
}
function useWorktreeTarget(props: NewWorktreeProps, form: WorktreeForm) {
  const { repo, open } = props;
  const branches = useBackend('branches', { repo }, open).data ?? [];
  const refs = branchRefs(branches);
  const chosenBase = baseOrHead(form.base, refs.head);
  const mode = kinds[form.kind];
  const reference = referenceOf[mode]({ ...form, chosenBase: chosenBase });
  const target = useBackend(
    'worktree_target',
    { repo: repo, mode: mode, ref: reference, path: form.custom ?? '' },
    open && needsTarget(mode, form.existing),
  ).data;
  return {
    branches: branches,
    refs: refs,
    chosenBase: chosenBase,
    mode: mode,
    target: target,
  };
}
function folderChoice(custom: string | null, target?: WorktreeTarget) {
  const occupied = Boolean(target) && !target?.free;
  return {
    folder: custom ?? target?.path ?? '',
    taken: Boolean(custom) && occupied,
  };
}
function useNewWorktree(props: NewWorktreeProps) {
  const { form, update, reset } = useFormState(emptyWorktreeForm);
  const [createMode, setCreateMode] = useState<CreateMode>('switch');
  const located = useWorktreeTarget(props, form);
  const { mode, target, branches } = located;
  const { name, existing, custom } = form;
  const { folder, taken } = folderChoice(custom, target);
  const problem = mode === 'new' && name ? nameProblem(name, branches) : null;
  const incomplete = missingChoice({ mode, name, existing, problem });
  const close = () => {
    props.onOpenChange(false);
    reset();
  };
  return {
    ...located,
    form: form,
    update: update,
    createMode: createMode,
    setCreateMode: setCreateMode,
    folder: folder,
    taken: taken,
    problem: problem,
    blocked: props.disabled || !folder || taken || incomplete,
    tracked: trackedName(located.refs.remote, existing),
    close: close,
  };
}
type WorktreeState = ReturnType<typeof useNewWorktree>;
function BaseChoice({ state, label }: { state: WorktreeState; label: string }) {
  const detachedTarget = state.mode === 'detached' && state.target;
  return (
    <BaseBranchSelect
      label={label}
      value={state.chosenBase}
      refs={state.refs}
      onChange={(next) => state.update({ base: next })}
    >
      {detachedTarget && (
        <p className={mutedLabel}>
          Checks out <span className="font-mono">{detachedTarget.label}</span>{' '}
          without creating a branch.
        </p>
      )}
    </BaseBranchSelect>
  );
}
function ExistingBranchField({ state }: { state: WorktreeState }) {
  const remote = state.refs.remote;
  const free = state.branches.filter(
    (branch) => !branch.remote && !branch.worktree,
  );
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>Branch</span>
      <Select
        label="Branch"
        placeholder="Choose a branch"
        icon={branchIcon}
        mono
        value={state.form.existing}
        groups={[
          { label: 'Local', options: free.map((branch) => branch.name) },
          { label: 'Remote', options: remote },
        ].filter((group) => group.options.length)}
        badges={Object.fromEntries(remote.map((branch) => [branch, 'remote']))}
        onChange={(next) => state.update({ existing: next, custom: null })}
      />
      {state.tracked && (
        <p className={mutedLabel}>
          Creates <span className="font-mono">{state.tracked}</span> tracking
          it.
        </p>
      )}
    </div>
  );
}
function NewBranchFields({ state }: { state: WorktreeState }) {
  return (
    <>
      <BranchNameField
        id="new-worktree-branch"
        hintId="new-worktree-branch-hint"
        label="Branch name"
        value={state.form.name}
        problem={state.problem}
        onChange={(next) => state.update({ name: next })}
      />
      <BaseChoice state={state} label="Based on" />
    </>
  );
}
function BranchFields({ state }: { state: WorktreeState }) {
  if (state.mode === 'detached')
    return <BaseChoice state={state} label="Start from" />;
  if (state.mode === 'new') return <NewBranchFields state={state} />;
  return <ExistingBranchField state={state} />;
}
async function chooseFolder(state: WorktreeState) {
  const chosen = await choose({
    directory: true,
    multiple: false,
    title: 'Choose worktree folder',
  });
  if (typeof chosen === 'string') state.update({ custom: chosen });
}
function FolderHint({ taken }: { taken: boolean }) {
  if (taken)
    return (
      <FieldError>This folder already exists and is not empty.</FieldError>
    );
  return (
    <p className={mutedLabel}>
      Ignored files such as <span className="font-mono">node_modules</span> and{' '}
      <span className="font-mono">.env</span> are not copied.
    </p>
  );
}
function FolderField({ state }: { state: WorktreeState }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor="new-worktree-folder">Folder</label>
      <div className="flex gap-2">
        <TextInput
          id="new-worktree-folder"
          aria-invalid={state.taken}
          aria-describedby="new-worktree-folder-hint"
          className={`${field} h-8 min-w-0 flex-1 font-mono text-diff`}
          value={state.folder}
          onChange={(event) => state.update({ custom: event.target.value })}
        />
        <Button
          variant="standard"
          className="h-8"
          onClick={() => void chooseFolder(state)}
        >
          Choose…
        </Button>
      </div>
      <div id="new-worktree-folder-hint">
        <FolderHint taken={state.taken} />
      </div>
    </div>
  );
}
function submitWorktree(props: NewWorktreeProps, state: WorktreeState) {
  const { mode, form } = state;
  return createThenSwitch({
    mode: state.createMode,
    create: () =>
      perform('worktree_add', {
        repo: props.repo,
        path: state.folder,
        mode: mode,
        branch: mode === 'new' ? form.name : form.existing,
        base: state.chosenBase,
      }),
    finish: state.close,
    switchTo: async (created) => {
      if (props.project) await switchWorktree(props.project, created);
    },
  });
}
export function NewWorktree(props: NewWorktreeProps) {
  const state = useNewWorktree(props);
  return (
    <Modal
      title="New worktree"
      open={props.open}
      onOpenChange={(next) => (next ? props.onOpenChange(true) : state.close())}
      footer={
        <CreateFooter
          form="new-worktree-form"
          mode={state.createMode}
          disabled={state.blocked}
          optionsLabel="Create worktree options"
          onMode={state.setCreateMode}
          onCancel={state.close}
        />
      }
    >
      <form
        id="new-worktree-form"
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (state.blocked) return;
          await submitWorktree(props, state);
        }}
      >
        <Choice
          label="Worktree branch"
          appearance="radio"
          value={state.form.kind}
          options={keysOf(kinds)}
          onChange={(next) => state.update({ kind: next, custom: null })}
        />
        <BranchFields state={state} />
        <FolderField state={state} />
      </form>
    </Modal>
  );
}
