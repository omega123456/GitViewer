import type { ReactNode } from 'react';
import { GitBranch } from 'lucide-react';
import {
  baseBadges,
  baseGroups,
  sanitizeBranchName,
  type BranchRefs,
} from '../../lib/branch-name';
import type { CreateMode } from '../../lib/create';
import { Button } from '../shared/Button';
import { CreateButton } from '../shared/CreateButton';
import { Select } from '../shared/Select';
import { TextInput } from '../shared/TextInput';
import { field, mutedLabel } from '../shared/styles';
import { FieldError } from '../states/Errors';
export const branchIcon = (
  <GitBranch className="size-3.5 shrink-0 text-muted dark:text-muted-dark" />
);
export function BranchNameField({
  id,
  hintId,
  label,
  value,
  problem,
  onChange,
}: {
  id: string;
  hintId: string;
  label: string;
  value: string;
  problem: string | null;
  onChange: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id}>{label}</label>
      <TextInput
        id={id}
        aria-invalid={Boolean(problem)}
        aria-describedby={hintId}
        className={`${field} h-8 font-mono text-diff`}
        placeholder="feature/short-description"
        value={value}
        onChange={(event) => onChange(sanitizeBranchName(event.target.value))}
      />
      <div id={hintId}>
        {problem ? (
          <FieldError>{problem}</FieldError>
        ) : (
          <p className={mutedLabel}>Spaces become dashes.</p>
        )}
      </div>
    </div>
  );
}
export function BaseBranchSelect({
  label,
  value,
  refs,
  onChange,
  children,
}: {
  label: string;
  value: string;
  refs: BranchRefs;
  onChange: (base: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <Select
        label={label}
        placeholder="Current branch"
        icon={branchIcon}
        mono
        value={value}
        groups={baseGroups(refs)}
        badges={baseBadges(refs.head)}
        onChange={onChange}
      />
      {children}
    </div>
  );
}
export function CreateFooter({
  form,
  mode,
  disabled,
  optionsLabel,
  onMode,
  onCancel,
}: {
  form: string;
  mode: CreateMode;
  disabled: boolean;
  optionsLabel: string;
  onMode: (mode: CreateMode) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <CreateButton
        form={form}
        mode={mode}
        disabled={disabled}
        optionsLabel={optionsLabel}
        onMode={onMode}
      />
      <Button variant="standard" className="h-8" onClick={onCancel}>
        Cancel
      </Button>
    </>
  );
}
