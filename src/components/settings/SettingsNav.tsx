import { Download, Sparkles, SlidersHorizontal } from 'lucide-react';
import { useSettingsNav, type SettingsPane } from '../../stores/settings-nav';
import { focus } from '../shared/styles';
const panes: { id: SettingsPane; label: string; icon: typeof Download }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'updates', label: 'Updates', icon: Download },
];
export function SettingsNav() {
  const current = useSettingsNav((state) => state.pane);
  return (
    <nav
      aria-label="Settings sections"
      className="flex w-settings-nav shrink-0 flex-col gap-0.5 border-r border-line bg-sub p-2 dark:border-line-dark dark:bg-sub-dark"
    >
      {panes.map(({ id, label, icon: Icon }) => {
        const active = current === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => useSettingsNav.getState().select(id)}
            className={`relative flex items-center gap-2 overflow-hidden rounded px-2.5 py-1.5 text-left text-xs ${active ? 'bg-selected font-medium text-ink dark:bg-selected-dark dark:text-ink-dark' : 'text-muted hover:bg-hover dark:hover:bg-hover-dark'} ${focus}`}
          >
            {active && (
              <span className="absolute inset-y-0 left-0 w-accent bg-accent dark:bg-accent-dark" />
            )}
            <Icon className="size-3.5 shrink-0" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
