import { createModes, type CreateMode } from '../../lib/create';
import { keysOf } from '../../lib/options';
import { SplitButton, SplitMenu, SplitPrimary } from './SplitButton';
const createModeOptions = keysOf(createModes);
export function CreateButton({
  mode,
  disabled,
  optionsLabel,
  form,
  onMode,
}: {
  mode: CreateMode;
  disabled: boolean;
  optionsLabel: string;
  form: string;
  onMode: (mode: CreateMode) => void;
}) {
  return (
    <SplitButton>
      <SplitPrimary
        size="regular"
        type="submit"
        form={form}
        disabled={disabled}
      >
        {createModes[mode]}
      </SplitPrimary>
      <SplitMenu
        size="regular"
        label={optionsLabel}
        disabled={disabled}
        width="w-44"
        value={mode}
        options={createModeOptions}
        onChange={onMode}
        renderOption={(option) => createModes[option]}
      />
    </SplitButton>
  );
}
