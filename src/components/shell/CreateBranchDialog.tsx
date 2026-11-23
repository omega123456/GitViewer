import { useState, type FormEvent } from 'react';
import type { FormState } from '../../lib/form-state';
import { perform } from '../../lib/query';
import { checkout } from '../../lib/checkout';
import { createThenSwitch, type CreateMode } from '../../lib/create';
import { baseOrHead, branchRefs, nameProblem } from '../../lib/branch-name';
import type { Branch } from '../../lib/types';
import { Modal } from '../shared/Modal';
import { BaseBranchSelect, BranchNameField, CreateFooter } from './BranchForm';

export interface BranchForm {
  creating: boolean;
  name: string;
  base: string;
}
export const closedBranchForm: BranchForm = {
  creating: false,
  name: '',
  base: '',
};
interface CreateBranchProps {
  repo: string;
  disabled: boolean;
  form: FormState<BranchForm>;
  branches: Branch[];
}
function useCreateBranch({
  repo,
  disabled,
  form,
  branches,
}: CreateBranchProps) {
  const [mode, setMode] = useState<CreateMode>('switch');
  const { name, base } = form.form;
  const refs = branchRefs(branches);
  const chosenBase = baseOrHead(base, refs.head);
  const problem = name ? nameProblem(name, branches) : null;
  const blocked = disabled || !name || Boolean(problem);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    await createThenSwitch({
      mode: mode,
      create: () =>
        perform('branch_create', {
          repo: repo,
          name: name,
          base: chosenBase,
          checkout: false,
        }),
      finish: form.reset,
      switchTo: () => checkout(repo, name),
    });
  };
  return {
    mode: mode,
    setMode: setMode,
    refs: refs,
    chosenBase: chosenBase,
    problem: problem,
    blocked: blocked,
    submit: submit,
  };
}
export function CreateBranchDialog(props: CreateBranchProps) {
  const { form } = props;
  const { creating, name } = form.form;
  const { mode, setMode, refs, chosenBase, problem, blocked, submit } =
    useCreateBranch(props);
  const setCreating = (next: boolean) => form.update({ creating: next });
  return (
    <Modal
      title="New branch"
      focusId="new-branch-name"
      open={creating}
      onOpenChange={setCreating}
      footer={
        <CreateFooter
          form="new-branch-form"
          mode={mode}
          disabled={blocked}
          optionsLabel="Create options"
          onMode={setMode}
          onCancel={() => setCreating(false)}
        />
      }
    >
      <form
        id="new-branch-form"
        className="flex flex-col gap-4"
        onSubmit={submit}
      >
        <BranchNameField
          id="new-branch-name"
          hintId="new-branch-hint"
          label="Name"
          value={name}
          problem={problem}
          onChange={(next) => form.update({ name: next })}
        />
        <BaseBranchSelect
          label="Based on"
          value={chosenBase}
          refs={refs}
          onChange={(next) => form.update({ base: next })}
        />
      </form>
    </Modal>
  );
}
