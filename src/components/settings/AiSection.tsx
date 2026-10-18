import { useRef, useState } from 'react';
import {
  AlignLeft,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Globe,
  Sparkles,
} from 'lucide-react';
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
import { SettingCard, SettingGroup, card } from './SettingCard';

type TestResult = { ok: true; count: number } | { ok: false; message: string };

const states = {
  unconfigured: {
    icon: CircleAlert,
    label: 'Not configured',
    tone: 'text-muted dark:text-muted-dark',
  },
  untested: {
    icon: Clock,
    label: 'Configured, not tested',
    tone: 'text-caution dark:text-caution-dark',
  },
  connected: {
    icon: CircleCheck,
    label: 'Connected',
    tone: 'text-add-ink dark:text-add-ink-dark',
  },
  failed: {
    icon: CircleX,
    label: 'Connection failed',
    tone: 'text-error-ink dark:text-error-ink-dark',
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
  const { icon: Icon, label, tone } = states[state];
  return (
    <section aria-label="AI" className="flex flex-col gap-4.5">
      <div className={`flex min-h-13 items-center gap-3 px-4 py-2.5 ${card}`}>
        <Icon className={`size-4 shrink-0 ${tone}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{label}</span>
          <span
            role="status"
            aria-live="polite"
            className={`block text-label ${state === 'failed' ? tone : 'text-muted dark:text-muted-dark'}`}
          >
            {aiStateNote(state, result)}
          </span>
        </span>
        <Button
          variant="standard"
          className="h-8"
          disabled={!settings.ai.baseUrl || testing}
          onClick={() => void test()}
        >
          Test connection
        </Button>
      </div>
      <SettingGroup title="Connection">
        <SettingCard
          icon={<Globe className="size-4" />}
          title="Endpoint"
          description="Base URL including its version path"
        >
          <span className="block w-75">
            <TextInput
              aria-label="Endpoint"
              placeholder="https://api.openai.com/v1"
              value={endpoint}
              className={`${field} h-8 font-mono text-diff`}
              onChange={(event) => setEndpoint(event.target.value)}
              onBlur={() => commit({ baseUrl: endpoint })}
            />
          </span>
        </SettingCard>
        <ApiKeyField settings={settings} />
        <SettingCard
          icon={<Sparkles className="size-4" />}
          title="Model"
          description="Fetched from the endpoint"
          below={
            !listable ? (
              <p className="text-label text-muted dark:text-muted-dark">
                Enter an endpoint to load the list.
              </p>
            ) : (
              !models.isPending &&
              !options.length && (
                <FieldError>
                  This endpoint does not list models. Use one that does.
                </FieldError>
              )
            )
          }
        >
          <span className="block w-50">
            <Select
              label="Model"
              placeholder="Select a model"
              mono
              value={settings.ai.model}
              options={options}
              disabled={!options.length}
              onChange={(model) => commit({ model })}
            />
          </span>
        </SettingCard>
      </SettingGroup>
      <SettingGroup title="Prompt">
        <SettingCard
          icon={<AlignLeft className="size-4" />}
          title="Commit message prompt"
          description="Sent with every staged diff"
          below={
            <TextArea
              aria-label="Prompt"
              rows={4}
              value={prompt}
              className={`${field} resize-none py-1.5 text-sm`}
              onChange={(event) => setPrompt(event.target.value)}
              onBlur={() => commit({ prompt })}
            />
          }
        />
      </SettingGroup>
    </section>
  );
}
