import { TextInput } from '../shared/TextInput';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Eye, EyeOff, Search } from 'lucide-react';
import { useActionRegistry } from '../../lib/actions';
import { fuzzySearch } from '../../lib/fuzzy';
import { handleKeyByTable } from '../../lib/keyboard';
import { useBackend, useStatuses } from '../../lib/query';
import { usePalette } from '../../stores/palette';
import { recentTabs, useTabs } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { clickable, focusInset, pill, selectedRow } from '../shared/styles';
import { stepIndex } from '../../lib/list';
import { emptyHints, groupBuilders, type Row } from './palette-groups';
const modes = {
  commands: {
    chip: 'Commands',
    label: 'Find command',
    placeholder: 'Search commands…',
    noun: 'command',
  },
  files: {
    chip: 'Files',
    label: 'Find file',
    placeholder: 'Search files by name…',
    noun: 'file',
  },
  repositories: {
    chip: 'Repositories',
    label: 'Find repository',
    placeholder: 'Search open repositories…',
    noun: 'open repository',
  },
};
const rowLimit = 50;
export function CommandPalette({ repo }: { repo: string }) {
  const scopes = useActionRegistry((state) => state.scopes);
  const open = usePalette((state) => state.open);
  const mode = usePalette((state) => state.mode);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const pointed = useRef(false);
  const preference = usePalette((state) => state.ignored);
  const settings = useBackend('settings_get', {});
  const ignored = preference ?? settings.data?.searchIgnoredFiles ?? false;
  const files = useBackend(
    'files',
    { repo, ignored },
    open && mode === 'files',
  );
  const status = useBackend('status', { repo }, open && mode === 'files');
  const tabs = useTabs(useShallow(recentTabs));
  const active = useTabs((state) => state.active);
  const views =
    open && mode === 'repositories' ? tabs.map((tab) => tab.view) : [];
  const statuses = useStatuses(views);
  const query = useDeferredValue(filter);
  const matches = useMemo(
    () =>
      mode === 'files'
        ? fuzzySearch(query, files.data ?? [], (path) => path).slice(
            0,
            rowLimit,
          )
        : [],
    [mode, query, files.data],
  );
  const entries = useMemo(
    () => new Map(status.data?.entries.map((entry) => [entry.path, entry])),
    [status.data],
  );
  const close = () => {
    setFilter('');
    setIndex(0);
    usePalette.getState().setOpen(false);
  };
  const groups = groupBuilders[mode]({
    repo: repo,
    filter: filter,
    scopes: scopes,
    tabs: tabs,
    active: active,
    statuses: statuses,
    matches: matches,
    entries: entries,
  });
  const visible = groups.filter((group) => group.rows.length);
  const rows = visible.flatMap((group) => group.rows);
  const enabled = rows.filter((row) => !row.disabled);
  const current = enabled[Math.min(index, enabled.length - 1)];
  const appKey = (id: string) =>
    scopes.app?.find((action) => action.id === id)?.key;
  const hint = emptyHints[mode]({
    ignored: ignored,
    openKey: appKey('open'),
    fileKey: appKey('files'),
  });
  const run = (row: Row) => {
    close();
    row.run();
  };
  const move = (delta: number) =>
    setIndex((value) =>
      enabled.length
        ? stepIndex(Math.min(value, enabled.length - 1), delta, enabled.length)
        : 0,
    );
  const page = (direction: number) => {
    const row = list.current?.querySelector<HTMLElement>('[data-current]');
    const step = Math.max(
      1,
      Math.floor((list.current?.clientHeight ?? 0) / (row?.offsetHeight || 1)),
    );
    setIndex((value) =>
      Math.max(
        0,
        Math.min(
          enabled.length - 1,
          Math.min(value, enabled.length - 1) + direction * step,
        ),
      ),
    );
  };
  useEffect(() => {
    if (pointed.current) {
      pointed.current = false;
      return;
    }
    list.current
      ?.querySelector('[data-current]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [current?.id]);
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
          {modes[mode].chip}
        </span>
        <TextInput
          aria-label={modes[mode].label}
          placeholder={modes[mode].placeholder}
          className="w-full bg-transparent text-base outline-none placeholder:text-muted dark:placeholder:text-muted-dark"
          value={filter}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) =>
            handleKeyByTable(event, {
              ArrowDown: () => move(1),
              ArrowUp: () => move(-1),
              PageDown: () => page(1),
              PageUp: () => page(-1),
              Enter: current ? () => run(current) : undefined,
            })
          }
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
      <div ref={list} className="max-h-120 overflow-auto p-1.5">
        {visible.map((group) => (
          <div key={group.name}>
            <h3 className="flex h-group items-center px-3 text-label font-semibold text-muted dark:text-muted-dark">
              {group.name}
            </h3>
            {group.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                disabled={row.disabled}
                data-current={row === current || undefined}
                onMouseEnter={(event) => {
                  const button = event.currentTarget;
                  const truncated = [...button.querySelectorAll('span')].some(
                    (span) => span.scrollWidth > span.clientWidth,
                  );
                  button.title = truncated ? row.title : '';
                  if (row.disabled || row === current) return;
                  pointed.current = true;
                  setIndex(enabled.indexOf(row));
                }}
                onClick={() => run(row)}
                className={`relative flex h-10 w-full items-center gap-3 rounded px-3 text-sm disabled:opacity-40 ${row === current ? selectedRow : ''} ${clickable} ${focusInset}`}
              >
                {row === current && <span className={pill} />}
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
            <p>{`No ${modes[mode].noun} matches${filter && ` “${filter}”`}`}</p>
            {hint && <p className="text-meta">{hint}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
