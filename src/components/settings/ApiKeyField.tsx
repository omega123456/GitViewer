import { useFormState } from '../../lib/form-state';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { invoke, normalizeError } from '../../lib/ipc';
import { saveSettings } from '../../lib/settings';
import type { SettingsResponse } from '../../lib/types';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { field, mutedLabel } from '../shared/styles';
import { FieldError } from '../states/Errors';
import { SettingCard } from './SettingCard';
interface KeyForm {
  draft: string;
  replacing: boolean;
  visible: boolean;
  confirming: boolean;
  error: string | null;
}
const emptyKeyForm: KeyForm = {
  draft: '',
  replacing: false,
  visible: false,
  confirming: false,
  error: null,
};
function ConfirmClearKey({
  onKeep,
  onRemove,
}: {
  onKeep: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <p className={mutedLabel}>Remove the stored API key?</p>
      <Button variant="standard" className="ml-auto h-8" onClick={onKeep}>
        Keep key
      </Button>
      <Button variant="primary" className="h-8" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}
function KeyEditor({
  form,
  keyStored,
  update,
  onSave,
}: {
  form: KeyForm;
  keyStored: boolean;
  update: (patch: Partial<KeyForm>) => void;
  onSave: (key: string) => void;
}) {
  const { draft, visible, error } = form;
  return (
    <div className="flex items-center gap-2">
      <TextInput
        aria-label="API key"
        aria-invalid={Boolean(error)}
        type={visible ? 'text' : 'password'}
        value={draft}
        className={`${field} h-8 text-sm`}
        onChange={(event) => update({ draft: event.target.value })}
      />
      <Button
        variant="command"
        aria-label="Show API key"
        aria-pressed={visible}
        onClick={() => update({ visible: !visible })}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
      <Button
        variant="primary"
        className="h-8"
        disabled={!draft}
        onClick={() => onSave(draft)}
      >
        Save key
      </Button>
      {keyStored && (
        <Button
          variant="standard"
          className="h-8"
          onClick={() => update({ replacing: false })}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
function StoredKeyActions({
  onReplace,
  onClear,
}: {
  onReplace: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="text-sm tracking-widest text-muted dark:text-muted-dark"
      >
        ••••••••••••
      </span>
      <span className="sr-only">A key is stored</span>
      <Button variant="standard" className="h-8" onClick={onReplace}>
        Replace
      </Button>
      <Button variant="command" onClick={onClear}>
        Clear
      </Button>
    </>
  );
}
export function ApiKeyField({ settings }: { settings: SettingsResponse }) {
  const { form, update, reset } = useFormState(emptyKeyForm);
  const { replacing, confirming, error } = form;
  const editing = replacing || !settings.keyStored;
  const write = async (key: string) => {
    update({ error: null });
    try {
      await invoke('ai_key_set', { key });
    } catch (failure) {
      update({ error: normalizeError(failure).message });
      return;
    }
    reset();
    await saveSettings(settings);
  };
  const body = confirming ? (
    <ConfirmClearKey
      onKeep={() => update({ confirming: false })}
      onRemove={() => void write('')}
    />
  ) : (
    editing && (
      <KeyEditor
        form={form}
        keyStored={settings.keyStored}
        update={update}
        onSave={(key) => void write(key)}
      />
    )
  );
  const idleStored = !confirming && !editing;
  return (
    <SettingCard
      icon={<KeyRound className="size-4" />}
      title="API key"
      description="Optional for local endpoints. Stored in the OS keychain"
      below={
        (body || error) && (
          <>
            {body}
            {error && <FieldError>{error}</FieldError>}
          </>
        )
      }
    >
      {idleStored && (
        <StoredKeyActions
          onReplace={() => update({ replacing: true })}
          onClear={() => update({ confirming: true })}
        />
      )}
    </SettingCard>
  );
}
