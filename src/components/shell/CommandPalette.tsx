import { TextInput } from '../shared/TextInput';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { useActionRegistry } from '../../lib/actions';
import { shortcutLabel, type Action } from '../../lib/keyboard';
import { usePalette } from '../../stores/palette';
import { Modal } from '../shared/Modal';
import { focus } from '../shared/styles';
const groupNames: Record<string, string> = {
  app: 'Application',
  repository: 'Repository',
  branches: 'Branches',
  diff: 'Diff',
  stashes: 'Stashes',
  image: 'Image',
};
export function CommandPalette({ repo }: { repo: string }) {
  const scopes = useActionRegistry((state) => state.scopes);
  const open = usePalette((s) => s.open);
  const [filter, setFilter] = useState('');
  const groups = Object.entries(scopes)
    .filter(([scope]) => scope === 'app' || scope.startsWith(`${repo}:`))
    .map(([scope, actions]) => ({
      name: groupNames[scope.split(':').at(-1)!] ?? scope,
      actions: actions.filter((action) =>
        action.label.toLowerCase().includes(filter.toLowerCase()),
      ),
    }))
    .filter((group) => group.actions.length);
  const first = groups
    .flatMap((group) => group.actions)
    .find((action) => !action.disabled);
  const run = (action: Action) => {
    usePalette.getState().setOpen(false);
    void action.run();
  };
  return (
    <Modal
      hideChrome
      title="Command palette"
      open={open}
      onOpenChange={usePalette.getState().setOpen}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 dark:border-line-dark">
        <Search className="size-3.5 shrink-0 text-faint dark:text-faint-dark" />
        <TextInput
          aria-label="Find command"
          placeholder="Type a command…"
          className={`w-full bg-transparent py-2.5 text-xs outline-none`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && first) run(first);
          }}
        />
      </div>
      <div className="max-h-80 overflow-auto py-1">
        {groups.map((group) => (
          <div key={group.name}>
            <h3 className="flex h-group items-center px-3 text-label font-semibold tracking-wider text-faint uppercase dark:text-faint-dark">
              {group.name}
            </h3>
            {group.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={action.disabled}
                onClick={() => run(action)}
                className={`flex h-section w-full items-center gap-2 px-3 text-xs disabled:opacity-40 ${action === first ? 'bg-hover dark:bg-hover-dark' : 'hover:bg-hover dark:hover:bg-hover-dark'} ${focus}`}
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center text-muted">
                  {action.icon}
                </span>
                <span className="truncate">{action.label}</span>
                <kbd className="ml-auto shrink-0 font-mono text-label text-muted">
                  {shortcutLabel(action.key)}
                </kbd>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted">
            No matching command.
          </p>
        )}
      </div>
    </Modal>
  );
}
