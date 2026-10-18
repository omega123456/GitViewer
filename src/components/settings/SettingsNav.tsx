import { Download, Sparkles, SlidersHorizontal } from 'lucide-react';
import { useBackend } from '../../lib/query';
import { useSettingsNav, type SettingsPane } from '../../stores/settings-nav';
import { focus, pill } from '../shared/styles';
export const panes: {
  id: SettingsPane;
  label: string;
  icon: typeof Download;
}[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'updates', label: 'Updates', icon: Download },
];
export function SettingsNav() {
  const current = useSettingsNav((state) => state.pane);
  const version = useBackend('update_get', {}).data?.currentVersion;
  return (
    <nav
      aria-label="Settings sections"
      className="flex w-settings-nav shrink-0 flex-col gap-0.5 px-2 pt-1 pb-4"
    >
      {panes.map(({ id, label, icon: Icon }) => {
        const active = current === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => useSettingsNav.getState().select(id)}
            className={`relative flex h-8.5 shrink-0 items-center gap-3 rounded px-3 text-left text-sm text-ink hover:bg-tab-hover dark:text-ink-dark dark:hover:bg-tab-hover-dark ${active ? 'bg-tab-hover dark:bg-tab-hover-dark' : ''} ${focus}`}
          >
            {active && <span className={pill} />}
            <Icon className="size-4 shrink-0" />
            {label}
          </button>
        );
      })}
      {version && (
        <p className="mt-6 px-3 text-label text-faint dark:text-faint-dark">
          GitViewer {version}
        </p>
      )}
    </nav>
  );
}
