import { useBackend } from './lib/query';
import type { Settings } from './lib/types';
import { AppShell } from './components/shell/AppShell';
import { MissingGit } from './components/states/MissingGit';
import { State } from './components/states/State';
const defaults: Settings = {
  theme: 'system',
  density: 'comfortable',
  diffMode: 'split',
};
export default function App() {
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
