import { TextInput } from '../shared/TextInput';
import { useState, type ReactNode } from 'react';
import { Eye, EyeOff, Search } from 'lucide-react';
import { useActionRegistry } from '../../lib/actions';
import { fuzzyFilter } from '../../lib/fuzzy';
import { shortcutLabel } from '../../lib/keyboard';
import { useBackend } from '../../lib/query';
import { useLayout } from '../../stores/layout';
import { usePalette } from '../../stores/palette';
import { useSelection } from '../../stores/selection';
import { FileIcon } from '../sidebar/FileIcon';
import { sourceFor } from '../sidebar/nodes';
import { StatusBadge } from '../sidebar/StatusBadge';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { focusInset } from '../shared/styles';
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
  label: ReactNode;
  trailing: ReactNode;
  disabled?: boolean;
  run: () => void;
}
const rowLimit = 50;
function Keys({ shortcut }: { shortcut: string }) {
  const keys = shortcutLabel(shortcut)
    .split('+')
    .filter(Boolean)
    .map((key) => (key.length === 1 ? key.toUpperCase() : key));
  return (
    <span aria-hidden className="ml-auto flex shrink-0 gap-1">
      {keys.map((key, index) => (
        <kbd
          key={index}
          className="flex h-6 min-w-6 items-center justify-center rounded border border-b-2 border-line bg-sub px-1.5 font-mono text-meta text-muted dark:border-line-dark dark:bg-sub-dark dark:text-muted-dark"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
function FileLabel({ path }: { path: string }) {
  const slash = path.lastIndexOf('/');
  return (
    <span className="flex min-w-0 items-baseline gap-2.5">
      <span className="shrink-0 font-medium">{path.slice(slash + 1)}</span>
      {slash > 0 && (
        <span className="truncate text-meta text-muted dark:text-muted-dark">
          {path.slice(0, slash)}
        </span>
      )}
    </span>
  );
}
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
                  icon: (
                    <FileIcon
                      name={path.slice(path.lastIndexOf('/') + 1)}
                      directory={false}
                      size="size-3.5"
                    />
                  ),
                  label: <FileLabel path={path} />,
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
                    useLayout.getState().update(repo, { mode: 'working' });
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
                label: <span className="truncate">{action.label}</span>,
                trailing: <Keys shortcut={action.key} />,
                disabled: action.disabled,
                run: () => void action.run(),
              }),
            ),
          }));
  const visible = groups.filter((group) => group.rows.length);
  const rows = visible.flatMap((group) => group.rows);
  const enabled = rows.filter((row) => !row.disabled);
  const current = enabled[Math.min(index, enabled.length - 1)];
  const fileKey = scopes.app?.find((action) => action.id === 'files')?.key;
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
    <Modal
      hideChrome
      size="palette"
      title="Command palette"
      open={open}
      onOpenChange={close}
    >
      <div className="flex h-14 items-center gap-3 border-b border-line pr-3 pl-4 dark:border-line-dark">
        <Search className="size-5 shrink-0 text-muted dark:text-muted-dark" />
        <span className="shrink-0 rounded-full bg-hover px-2.5 py-0.5 text-meta font-medium text-muted dark:bg-hover-dark dark:text-muted-dark">
          {mode === 'files' ? 'Files' : 'Commands'}
        </span>
        <TextInput
          aria-label={mode === 'files' ? 'Find file' : 'Find command'}
          placeholder={
            mode === 'files' ? 'Search files by name…' : 'Search commands…'
          }
          className="w-full bg-transparent text-base outline-none placeholder:text-muted dark:placeholder:text-muted-dark"
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
            variant="icon"
            className="size-8 text-muted aria-pressed:bg-selected aria-pressed:text-accent dark:text-muted-dark dark:aria-pressed:bg-selected-dark dark:aria-pressed:text-accent-dark"
            aria-label="Include ignored files"
            aria-pressed={ignored}
            onClick={() => usePalette.getState().setIgnored(!ignored)}
          >
            {ignored ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
          </Button>
        )}
      </div>
      <div className="max-h-120 overflow-auto p-1.5">
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
                className={`flex h-10 w-full items-center gap-3 rounded px-3 text-sm disabled:opacity-40 ${row === current ? 'bg-selected dark:bg-selected-dark' : 'hover:bg-hover dark:hover:bg-hover-dark'} ${focusInset}`}
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center text-muted dark:text-muted-dark">
                  {row.icon}
                </span>
                {row.label}
                {row.trailing}
              </button>
            ))}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="flex flex-col gap-1 px-3 py-10 text-center text-sm text-muted dark:text-muted-dark">
            <p>
              {`No ${mode === 'files' ? 'file' : 'command'} matches${filter && ` “${filter}”`}`}
            </p>
            {mode === 'files' && !ignored && (
              <p className="text-meta">
                Include ignored files to widen the search
              </p>
            )}
            {mode === 'commands' && fileKey && (
              <p className="text-meta">
                Press {shortcutLabel(fileKey)} to search files instead
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
