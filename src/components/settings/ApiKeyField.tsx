import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { invoke, normalizeError } from '../../lib/ipc';
import { perform } from '../../lib/query';
import type { SettingsResponse } from '../../lib/types';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import { FieldError } from '../states/Errors';
import { SettingCard } from './SettingCard';
export function ApiKeyField({ settings }: { settings: SettingsResponse }) {
  const [draft, setDraft] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = replacing || !settings.keyStored;
  const write = async (key: string) => {
    setError(null);
    try {
      await invoke('ai_key_set', { key });
    } catch (failure) {
      setError(normalizeError(failure).message);
      return;
    }
    setDraft('');
    setReplacing(false);
    setVisible(false);
    setConfirming(false);
    await perform('settings_set', settings);
  };
  const below = confirming ? (
    <div className="flex items-center gap-2">
      <p className="text-label text-muted dark:text-muted-dark">
        Remove the stored API key?
      </p>
      <Button
        variant="standard"
        className="ml-auto h-8"
        onClick={() => setConfirming(false)}
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
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          variant="command"
          aria-label="Show API key"
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
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
            onClick={() => setReplacing(false)}
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
            onClick={() => setReplacing(true)}
          >
            Replace
          </Button>
          <Button variant="command" onClick={() => setConfirming(true)}>
            Clear
          </Button>
        </>
      )}
    </SettingCard>
  );
}
