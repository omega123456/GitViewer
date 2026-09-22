import { useRef, useState } from 'react';
import { CircleAlert, CircleCheck, CircleX, Clock } from 'lucide-react';
import { invoke, normalizeError } from '../../lib/ipc';
import { perform, useBackend } from '../../lib/query';
import type { AiSettings, SettingsResponse } from '../../lib/types';
import { Button } from '../shared/Button';
import { Select } from '../shared/Select';
import { TextArea } from '../shared/TextArea';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import { FieldError } from '../states/Errors';
import { ApiKeyField } from './ApiKeyField';
import { SettingRow } from './GeneralSection';

type TestResult = { ok: true; count: number } | { ok: false; message: string };

const states = {
  unconfigured: {
    icon: CircleAlert,
    label: 'Not configured',
    tone: 'text-muted dark:text-muted-dark',
    dot: 'bg-muted dark:bg-muted-dark',
  },
  untested: {
    icon: Clock,
    label: 'Configured, not tested',
    tone: 'text-muted dark:text-muted-dark',
    dot: 'bg-muted dark:bg-muted-dark',
  },
  connected: {
    icon: CircleCheck,
    label: 'Connected',
    tone: 'text-add-ink dark:text-add-ink-dark',
    dot: 'bg-add-ink dark:bg-add-ink-dark',
  },
  failed: {
    icon: CircleX,
    label: 'Connection failed',
    tone: 'text-error-ink dark:text-error-ink-dark',
    dot: 'bg-error-ink dark:bg-error-ink-dark',
  },
};

export function aiState(ai: AiSettings, result: TestResult | null) {
  if (!ai.baseUrl || !ai.model) return 'unconfigured';
  if (!result) return 'untested';
  return result.ok ? 'connected' : 'failed';
}

export function aiStateNote(
  state: keyof typeof states,
  result: TestResult | null,
) {
  if (state === 'unconfigured')
    return 'Add an endpoint and pick a model to generate commit messages.';
  if (state === 'failed' && result && !result.ok) return result.message;
  if (state === 'connected' && result && result.ok)
    return result.count
      ? `${result.count} ${result.count === 1 ? 'model' : 'models'} available. The Generate button shows in the commit box.`
      : 'Connected, but this endpoint lists no models.';
  return 'The Generate button shows in the commit box.';
}

export function AiSection({ settings }: { settings: SettingsResponse }) {
  const [endpoint, setEndpoint] = useState(settings.ai.baseUrl);
  const [prompt, setPrompt] = useState(settings.ai.prompt);
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const written = useRef<Promise<unknown> | null>(null);
  const listable = Boolean(settings.ai.baseUrl);
  const models = useBackend('ai_models', {}, listable);
  const options = models.data ?? [];
  const save = (ai: AiSettings) => {
    setResult(null);
    written.current = perform('settings_set', { ...settings, ai });
    return written.current;
  };
  const commit = (ai: Partial<AiSettings>) => {
    const next = { ...settings.ai, baseUrl: endpoint, prompt, ...ai };
    if (
      next.baseUrl === settings.ai.baseUrl &&
      next.prompt === settings.ai.prompt &&
      next.model === settings.ai.model
    )
      return;
    void save(next);
  };
  const test = async () => {
    setTesting(true);
    await written.current;
    try {
      const list = await invoke('ai_models', {});
      setResult({ ok: true, count: list.length });
    } catch (failure) {
      setResult({ ok: false, message: normalizeError(failure).message });
    }
    setTesting(false);
  };
  const state = aiState(settings.ai, result);
  const { icon: Icon, label, tone, dot } = states[state];
  return (
    <section aria-label="AI" className="flex flex-col">
      <div className="flex items-center gap-2.5 rounded-md border border-line bg-sub p-3 dark:border-line-dark dark:bg-sub-dark">
        <span className={`size-status-dot shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0">
          <span
            className={`flex items-center gap-1.5 text-xs font-medium ${tone}`}
          >
            <Icon className="size-3.5 shrink-0" />
            {label}
          </span>
          <span
            role="status"
            aria-live="polite"
            className={`block text-label ${state === 'failed' ? tone : 'text-muted dark:text-muted-dark'}`}
          >
            {aiStateNote(state, result)}
          </span>
        </span>
        <Button
          className="ml-auto"
          disabled={!settings.ai.baseUrl || testing}
          onClick={() => void test()}
        >
          Test connection
        </Button>
      </div>
      <h3 className="pt-4 pb-0.5 text-label font-semibold tracking-wider text-muted uppercase">
        Connection
      </h3>
      <SettingRow
        title="Endpoint"
        description="Base URL including its version path"
        stack
      >
        <TextInput
          aria-label="Endpoint"
          placeholder="https://api.openai.com/v1"
          value={endpoint}
          className={`${field} font-mono text-label`}
          onChange={(event) => setEndpoint(event.target.value)}
          onBlur={() => commit({ baseUrl: endpoint })}
        />
      </SettingRow>
      <ApiKeyField settings={settings} />
      <SettingRow title="Model" description="Fetched from the endpoint" stack>
        <Select
          label="Model"
          placeholder="Select a model"
          value={settings.ai.model}
          options={options}
          disabled={!options.length}
          onChange={(model) => commit({ model })}
        />
        {!listable && (
          <p className="text-label text-muted">
            Enter an endpoint to load the list.
          </p>
        )}
        {listable && !models.isPending && !options.length && (
          <FieldError>
            This endpoint does not list models. Use one that does.
          </FieldError>
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
          value={prompt}
          className={`${field} resize-none`}
          onChange={(event) => setPrompt(event.target.value)}
          onBlur={() => commit({ prompt })}
        />
      </SettingRow>
    </section>
  );
}
