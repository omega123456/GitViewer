import { TextInput } from '../shared/TextInput';
import { useState, type ReactNode } from 'react';
import { Eye, EyeOff, File, Search } from 'lucide-react';
import { useActionRegistry } from '../../lib/actions';
import { fuzzyFilter } from '../../lib/fuzzy';
import { shortcutLabel } from '../../lib/keyboard';
import { useBackend } from '../../lib/query';
import { useLayout } from '../../stores/layout';
import { usePalette } from '../../stores/palette';
import { useSelection } from '../../stores/selection';
import { sourceFor } from '../sidebar/nodes';
import { StatusBadge } from '../sidebar/StatusBadge';
import { Button } from '../shared/Button';
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
interface Row {
  id: string;
  icon: ReactNode;
  label: string;
  trailing: ReactNode;
  disabled?: boolean;
  run: () => void;
}
const rowLimit = 50;
export function CommandPalette({ repo }: { repo: string }) {
  const scopes = useActionRegistry((state) => state.scopes);
  const open = usePalette((s) => s.open);
  const mode = usePalette((s) => s.mode);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const preference = usePalette((s) => s.ignored);
  const settings = useBackend('settings_get', {});
  const ignored = preference ?? settings.data?.searchIgnoredFiles ?? false;
  const files = useBackend(
    'files',
    { repo, ignored },
    open && mode === 'files',
  );
  const status = useBackend('status', { repo }, open && mode === 'files');
  const close = () => {
    setFilter('');
    setIndex(0);
    usePalette.getState().setOpen(false);
  };
  const groups =
    mode === 'files'
      ? [
          {
            name: 'Files',
            rows: fuzzyFilter(filter, files.data ?? [], (path) => path)
              .slice(0, rowLimit)
              .map((path): Row => {
                const entry = status.data?.entries.find(
                  (entry) => entry.path === path,
                );
                return {
                  id: path,
                  icon: <File className="size-3.5" />,
                  label: path,
                  trailing: (
                    <StatusBadge
                      status={
                        !entry
                          ? ''
                          : entry.worktree !== '.'
                            ? entry.worktree
                            : entry.index
                      }
                    />
                  ),
                  run: () => {
                    useLayout.getState().update(repo, { history: false });
                    useSelection
                      .getState()
                      .select(repo, { path, source: sourceFor(entry) });
                  },
                };
              }),
          },
        ]
      : Object.entries(scopes)
          .filter(([scope]) => scope === 'app' || scope.startsWith(`${repo}:`))
          .map(([scope, actions]) => ({
            name: groupNames[scope.split(':').at(-1)!] ?? scope,
            rows: fuzzyFilter(filter, actions, (action) => action.label).map(
              (action): Row => ({
                id: action.id,
                icon: action.icon,
                label: action.label,
                trailing: (
                  <kbd className="ml-auto shrink-0 font-mono text-label text-muted">
                    {shortcutLabel(action.key)}
                  </kbd>
                ),
                disabled: action.disabled,
                run: () => void action.run(),
              }),
            ),
          }));
  const visible = groups.filter((group) => group.rows.length);
  const rows = visible.flatMap((group) => group.rows);
  const enabled = rows.filter((row) => !row.disabled);
  const current = enabled[Math.min(index, enabled.length - 1)];
  const run = (row: Row) => {
    close();
    row.run();
  };
  const move = (delta: number) =>
    setIndex((value) =>
      enabled.length
        ? (Math.min(value, enabled.length - 1) + delta + enabled.length) %
          enabled.length
        : 0,
    );
  const update = (value: string) => {
    setFilter(value);
    setIndex(0);
  };
  return (
    <Modal hideChrome title="Command palette" open={open} onOpenChange={close}>
      <div className="flex items-center gap-2 border-b border-line px-3 dark:border-line-dark">
        <Search className="size-3.5 shrink-0 text-faint dark:text-faint-dark" />
        <TextInput
          aria-label={mode === 'files' ? 'Find file' : 'Find command'}
          placeholder={
            mode === 'files' ? 'Type a file name…' : 'Type a command…'
          }
          className={`w-full bg-transparent py-2.5 text-xs outline-none`}
          value={filter}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') move(1);
            else if (event.key === 'ArrowUp') move(-1);
            else if (event.key === 'Enter' && current) run(current);
            else return;
            event.preventDefault();
          }}
        />
        {mode === 'files' && (
          <Button
            aria-label="Include ignored files"
            aria-pressed={ignored}
            onClick={() => usePalette.getState().setIgnored(!ignored)}
          >
            {ignored ? (
              <Eye className="size-3.5" />
            ) : (
              <EyeOff className="size-3.5" />
            )}
          </Button>
        )}
      </div>
      <div className="max-h-80 overflow-auto py-1">
        {visible.map((group) => (
          <div key={group.name}>
            <h3 className="flex h-group items-center px-3 text-label font-semibold tracking-wider text-faint uppercase dark:text-faint-dark">
              {group.name}
            </h3>
            {group.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                disabled={row.disabled}
                onClick={() => run(row)}
                className={`flex h-section w-full items-center gap-2 px-3 text-xs disabled:opacity-40 ${row === current ? 'bg-hover dark:bg-hover-dark' : 'hover:bg-hover dark:hover:bg-hover-dark'} ${focus}`}
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center text-muted">
                  {row.icon}
                </span>
                <span className="truncate">{row.label}</span>
                {row.trailing}
              </button>
            ))}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted">
            {mode === 'files' ? 'No matching file.' : 'No matching command.'}
          </p>
        )}
      </div>
    </Modal>
  );
}
