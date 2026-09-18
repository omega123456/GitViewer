import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { invoke, normalizeError } from '../../lib/ipc';
import { perform } from '../../lib/query';
import type { SettingsResponse } from '../../lib/types';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import { SettingRow } from './GeneralSection';
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
  return (
    <SettingRow
      title="API key"
      description="Optional for local endpoints. Stored in the OS keychain"
      stack
    >
      {confirming && (
        <div className="flex items-center gap-2">
          <p className="text-label text-muted">Remove the stored API key?</p>
          <Button className="ml-auto" onClick={() => setConfirming(false)}>
            Keep key
          </Button>
          <Button variant="primary" onClick={() => void write('')}>
            Remove
          </Button>
        </div>
      )}
      {!confirming && editing && (
        <div className="flex items-center gap-2">
          <TextInput
            aria-label="API key"
            type={visible ? 'text' : 'password'}
            value={draft}
            className={field}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            aria-label="Show API key"
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </Button>
          <Button
            variant="primary"
            disabled={!draft}
            onClick={() => void write(draft)}
          >
            Save key
          </Button>
          {settings.keyStored && (
            <Button onClick={() => setReplacing(false)}>Cancel</Button>
          )}
        </div>
      )}
      {!confirming && !editing && (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`${field} tracking-widest text-muted`}
          >
            ••••••••••••
          </span>
          <span className="sr-only">A key is stored</span>
          <Button onClick={() => setReplacing(true)}>Replace</Button>
          <Button onClick={() => setConfirming(true)}>Clear</Button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="text-label text-remove-ink dark:text-remove-ink-dark"
        >
          {error}
        </p>
      )}
    </SettingRow>
  );
}
