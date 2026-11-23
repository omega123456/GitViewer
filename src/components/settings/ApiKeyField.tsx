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
export function ApiKeyField({ settings }: { settings: SettingsResponse }) {
  const { form, update, reset } = useFormState(emptyKeyForm);
  const { draft, replacing, visible, confirming, error } = form;
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
  const below = confirming ? (
    <div className="flex items-center gap-2">
      <p className={mutedLabel}>Remove the stored API key?</p>
      <Button
        variant="standard"
        className="ml-auto h-8"
        onClick={() => update({ confirming: false })}
      >
        Keep key
      </Button>
      <Button variant="primary" className="h-8" onClick={() => void write('')}>
        Remove
      </Button>
    </div>
  ) : (
    editing && (
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
          onClick={() => void write(draft)}
        >
          Save key
        </Button>
        {settings.keyStored && (
          <Button
            variant="standard"
            className="h-8"
            onClick={() => update({ replacing: false })}
          >
            Cancel
          </Button>
        )}
      </div>
    )
  );
  return (
    <SettingCard
      icon={<KeyRound className="size-4" />}
      title="API key"
      description="Optional for local endpoints. Stored in the OS keychain"
      below={
        (below || error) && (
          <>
            {below}
            {error && <FieldError>{error}</FieldError>}
          </>
        )
      }
    >
      {!confirming && !editing && (
        <>
          <span
            aria-hidden="true"
            className="text-sm tracking-widest text-muted dark:text-muted-dark"
          >
            ••••••••••••
          </span>
          <span className="sr-only">A key is stored</span>
          <Button
            variant="standard"
            className="h-8"
            onClick={() => update({ replacing: true })}
          >
            Replace
          </Button>
          <Button
            variant="command"
            onClick={() => update({ confirming: true })}
          >
            Clear
          </Button>
        </>
      )}
    </SettingCard>
  );
}
