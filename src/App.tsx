import { useBrowserRestrictions } from './lib/browser';
import { useBackend } from './lib/query';
import type { SettingsResponse } from './lib/types';
import { AppShell } from './components/shell/AppShell';
import { MissingGit } from './components/states/MissingGit';
import { State } from './components/states/State';
const defaults: SettingsResponse = {
  keyStored: false,
  theme: 'system',
  density: 'comfortable',
  diffMode: 'split',
  updateCheckInterval: '1d',
  installUpdateOnQuit: true,
  searchIgnoredFiles: false,
  pullOnCheckout: false,
  autoFetchInterval: 'off',
  smartCommit: 'ask',
  zoom: 100,
  maxFileTabs: 8,
  ai: {
    baseUrl: '',
    model: '',
    prompt:
      'Write a concise commit message for this diff (under 220 characters total).\n' +
      '- Subject line: Imperative mood, under 72 characters, summarizing the core functional change.\n' +
      '- Body (when needed): 1–2 short sentences explaining *why* the change was made or how behavior changed.\n' +
      '- Rules: Describe functional impact and intent, not code mechanics. Do not name specific classes/functions or mention routine test updates.',
  },
};
export default function App() {
  useBrowserRestrictions();
  const environment = useBackend('env', {});
  const preferences = useBackend('settings_get', {});
  if (environment.isPending)
    return (
      <main className="h-screen bg-surface text-ink dark:bg-surface-dark dark:text-ink-dark">
        <State title="Checking Git…" />
      </main>
    );
  if (environment.error || !environment.data?.supported)
    return (
      <MissingGit environment={environment.data} error={environment.error} />
    );
  return (
    <AppShell
      settings={preferences.data ?? defaults}
      version={environment.data.version}
    />
  );
}
