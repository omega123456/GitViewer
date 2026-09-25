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
  smartCommit: 'ask',
  zoom: 100,
  ai: {
    baseUrl: '',
    model: '',
    prompt:
      'Write a commit message for this diff. One short imperative subject line under 60 characters. Add a body only when needed.',
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
