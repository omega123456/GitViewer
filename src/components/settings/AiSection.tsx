import { useState } from 'react';
import { invoke, normalizeError } from '../../lib/ipc';
import { perform, useBackend } from '../../lib/query';
import type { AiSettings, SettingsResponse } from '../../lib/types';
import { Button } from '../shared/Button';
import { CheckBox } from '../shared/CheckBox';
import { Select } from '../shared/Select';
import { TextArea } from '../shared/TextArea';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import { ApiKeyField } from './ApiKeyField';
import { SettingRow } from './GeneralSection';
export function AiSection({ settings }: { settings: SettingsResponse }) {
  const [draft, setDraft] = useState<AiSettings>(settings.ai);
  const [result, setResult] = useState<string | null>(null);
  const listable = Boolean(settings.ai.baseUrl);
  const models = useBackend('ai_models', {}, listable);
  const options = models.data ?? [];
  const save = (ai: AiSettings) => perform('settings_set', { ...settings, ai });
  const test = async () => {
    setResult(null);
    await save(draft);
    try {
      const list = await invoke('ai_models', {});
      setResult(
        list.length
          ? `Connected — ${list.length} models available`
          : 'Connected, but this endpoint lists no models.',
      );
    } catch (failure) {
      setResult(normalizeError(failure).message);
    }
  };
  return (
    <section aria-label="AI" className="flex flex-col">
      <SettingRow
        title="Generate commit messages"
        description="Adds a button to the commit box"
      >
        <CheckBox
          label="Generate commit messages"
          checked={settings.ai.enabled}
          onChange={() =>
            void save({ ...settings.ai, enabled: !settings.ai.enabled })
          }
        />
      </SettingRow>
      <h3 className="pt-4 pb-0.5 text-label font-semibold tracking-wider text-muted uppercase">
        Connection
      </h3>
      <SettingRow
        title="Endpoint"
        description="Base URL including its version path"
        stack
      >
        <span className="flex items-center gap-2">
          <TextInput
            aria-label="Endpoint"
            placeholder="https://api.openai.com/v1"
            value={draft.baseUrl}
            className={`${field} font-mono text-label`}
            onChange={(event) =>
              setDraft({ ...draft, baseUrl: event.target.value })
            }
          />
          <Button onClick={() => void test()}>Test connection</Button>
        </span>
        {result && (
          <p role="status" className="text-label text-muted">
            {result}
          </p>
        )}
      </SettingRow>
      <ApiKeyField settings={settings} />
      <SettingRow title="Model" description="Fetched from the endpoint" stack>
        <Select
          label="Model"
          placeholder="Select a model"
          value={draft.model}
          options={options}
          disabled={!options.length}
          onChange={(model) => setDraft({ ...draft, model })}
        />
        {!listable && (
          <p className="text-label text-muted">
            Save an endpoint to load the list.
          </p>
        )}
        {listable && !models.isPending && !options.length && (
          <p
            role="alert"
            className="text-label text-remove-ink dark:text-remove-ink-dark"
          >
            This endpoint does not list models. Use one that does.
          </p>
        )}
      </SettingRow>
      <SettingRow
        title="Prompt"
        description="Sent with every staged diff"
        stack
      >
        <TextArea
          aria-label="Prompt"
          rows={4}
          value={draft.prompt}
          className={`${field} resize-none`}
          onChange={(event) =>
            setDraft({ ...draft, prompt: event.target.value })
          }
        />
        <span className="flex justify-end">
          <Button variant="primary" onClick={() => void save(draft)}>
            Save
          </Button>
        </span>
      </SettingRow>
    </section>
  );
}
