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
import { useBackend } from '../../lib/query';
import { plural } from '../../lib/text';
import { saveSettings } from '../../lib/settings';
import type { AiSettings, SettingsResponse } from '../../lib/types';
import { Button } from '../shared/Button';
import { Select } from '../shared/Select';
import { TextArea } from '../shared/TextArea';
import { TextInput } from '../shared/TextInput';
import { field, mutedLabel } from '../shared/styles';
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
      ? `${plural(result.count, 'model')} available. The Generate button shows in the commit box.`
      : 'Connected, but this endpoint lists no models.';
  return 'The Generate button shows in the commit box.';
}

function aiUnchanged(next: AiSettings, current: AiSettings) {
  return (
    next.baseUrl === current.baseUrl &&
    next.prompt === current.prompt &&
    next.model === current.model
  );
}

function AiStatusBanner({
  settings,
  result,
  testing,
  onTest,
}: {
  settings: SettingsResponse;
  result: TestResult | null;
  testing: boolean;
  onTest: () => void;
}) {
  const state = aiState(settings.ai, result);
  const { icon: Icon, label, tone } = states[state];
  const noteTone =
    state === 'failed' ? tone : 'text-muted dark:text-muted-dark';
  return (
    <div className={`flex min-h-13 items-center gap-3 px-4 py-2.5 ${card}`}>
      <Icon className={`size-4 shrink-0 ${tone}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span
          role="status"
          aria-live="polite"
          className={`block text-label ${noteTone}`}
        >
          {aiStateNote(state, result)}
        </span>
      </span>
      <Button
        variant="standard"
        className="h-8"
        disabled={!settings.ai.baseUrl || testing}
        onClick={onTest}
      >
        Test connection
      </Button>
    </div>
  );
}

function modelHint({
  listable,
  pending,
  hasOptions,
}: {
  listable: boolean;
  pending: boolean;
  hasOptions: boolean;
}) {
  if (!listable)
    return <p className={mutedLabel}>Enter an endpoint to load the list.</p>;
  if (pending || hasOptions) return null;
  return (
    <FieldError>
      This endpoint does not list models. Use one that does.
    </FieldError>
  );
}

function ModelSettingCard({
  model,
  listable,
  onChange,
}: {
  model: string;
  listable: boolean;
  onChange: (model: string) => void;
}) {
  const models = useBackend('ai_models', {}, listable);
  const options = models.data ?? [];
  const hint = modelHint({
    listable: listable,
    pending: models.isPending,
    hasOptions: options.length > 0,
  });
  return (
    <SettingCard
      icon={<Sparkles className="size-4" />}
      title="Model"
      description="Fetched from the endpoint"
      below={hint}
    >
      <span className="block w-50">
        <Select
          label="Model"
          placeholder="Select a model"
          mono
          value={model}
          options={options}
          disabled={!options.length}
          onChange={onChange}
        />
      </span>
    </SettingCard>
  );
}

function PromptGroup({
  prompt,
  onChange,
  onCommit,
}: {
  prompt: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
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
            onChange={(event) => onChange(event.target.value)}
            onBlur={onCommit}
          />
        }
      />
    </SettingGroup>
  );
}

function ConnectionGroup({
  settings,
  endpoint,
  onEndpointChange,
  onCommit,
}: {
  settings: SettingsResponse;
  endpoint: string;
  onEndpointChange: (value: string) => void;
  onCommit: (ai: Partial<AiSettings>) => void;
}) {
  return (
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
            onChange={(event) => onEndpointChange(event.target.value)}
            onBlur={() => onCommit({ baseUrl: endpoint })}
          />
        </span>
      </SettingCard>
      <ApiKeyField settings={settings} />
      <ModelSettingCard
        model={settings.ai.model}
        listable={Boolean(settings.ai.baseUrl)}
        onChange={(model) => onCommit({ model })}
      />
    </SettingGroup>
  );
}

export function AiSection({ settings }: { settings: SettingsResponse }) {
  const [endpoint, setEndpoint] = useState(settings.ai.baseUrl);
  const [prompt, setPrompt] = useState(settings.ai.prompt);
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const written = useRef<Promise<unknown> | null>(null);
  const commit = (ai: Partial<AiSettings>) => {
    const next = { ...settings.ai, baseUrl: endpoint, prompt: prompt, ...ai };
    if (aiUnchanged(next, settings.ai)) return;
    setResult(null);
    written.current = saveSettings(settings, { ai: next });
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
  return (
    <section aria-label="AI" className="flex flex-col gap-4.5">
      <AiStatusBanner
        settings={settings}
        result={result}
        testing={testing}
        onTest={() => void test()}
      />
      <ConnectionGroup
        settings={settings}
        endpoint={endpoint}
        onEndpointChange={setEndpoint}
        onCommit={commit}
      />
      <PromptGroup
        prompt={prompt}
        onChange={setPrompt}
        onCommit={() => commit({ prompt })}
      />
    </section>
  );
}
