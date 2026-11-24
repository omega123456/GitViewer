import { TextInput } from '../shared/TextInput';
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Eye, EyeOff, Search } from 'lucide-react';
import { useActionRegistry } from '../../lib/actions';
import { fuzzySearch } from '../../lib/fuzzy';
import { handleKeyByTable } from '../../lib/keyboard';
import { useBackend, useStatuses } from '../../lib/query';
import { usePalette, type PaletteMode } from '../../stores/palette';
import { recentTabs, useTabs } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { clickable, focusInset, pill, selectedRow } from '../shared/styles';
import {
  emptyCursor,
  moved,
  paged,
  pointedAt,
  searched,
  type PaletteCursor,
} from './palette-cursor';
import {
  emptyHints,
  groupBuilders,
  type Group,
  type Row,
} from './palette-groups';
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
type ModeCopy = (typeof modes)[PaletteMode];
function useIgnoredPreference() {
  const preference = usePalette((state) => state.ignored);
  const settings = useBackend('settings_get', {});
  return preference ?? settings.data?.searchIgnoredFiles ?? false;
}
function useFileMatches(repo: string, query: string) {
  const open = usePalette((state) => state.open);
  const mode = usePalette((state) => state.mode);
  const ignored = useIgnoredPreference();
  const listing = open && mode === 'files';
  const files = useBackend('files', { repo, ignored }, listing);
  const status = useBackend('status', { repo }, listing);
  const matches = useMemo(() => {
    if (mode !== 'files') return [];
    return fuzzySearch(query, files.data ?? [], (path) => path).slice(
      0,
      rowLimit,
    );
  }, [mode, query, files.data]);
  const entries = useMemo(
    () => new Map(status.data?.entries.map((entry) => [entry.path, entry])),
    [status.data],
  );
  return { ignored: ignored, matches: matches, entries: entries };
}
function useRepositoryRows() {
  const open = usePalette((state) => state.open);
  const mode = usePalette((state) => state.mode);
  const tabs = useTabs(useShallow(recentTabs));
  const active = useTabs((state) => state.active);
  const listing = open && mode === 'repositories';
  const views = listing ? tabs.map((tab) => tab.view) : [];
  return { tabs: tabs, active: active, statuses: useStatuses(views) };
}
function usePaletteGroups(repo: string, filter: string) {
  const scopes = useActionRegistry((state) => state.scopes);
  const mode = usePalette((state) => state.mode);
  const query = useDeferredValue(filter);
  const { ignored, matches, entries } = useFileMatches(repo, query);
  const repositories = useRepositoryRows();
  const groups = groupBuilders[mode]({
    ...repositories,
    repo: repo,
    filter: filter,
    scopes: scopes,
    matches: matches,
    entries: entries,
  });
  const appKey = (id: string) =>
    scopes.app?.find((action) => action.id === id)?.key;
  const hint = emptyHints[mode]({
    ignored: ignored,
    openKey: appKey('open'),
    fileKey: appKey('files'),
  });
  return { groups: groups, hint: hint, ignored: ignored };
}
function pageStep(list: HTMLDivElement | null) {
  const row = list?.querySelector<HTMLElement>('[data-current]');
  const rowHeight = row?.offsetHeight || 1;
  return Math.max(1, Math.floor((list?.clientHeight ?? 0) / rowHeight));
}
function useScrollToCurrent(
  list: RefObject<HTMLDivElement | null>,
  pointed: RefObject<boolean>,
  current?: Row,
) {
  useEffect(() => {
    if (pointed.current) {
      pointed.current = false;
      return;
    }
    list.current
      ?.querySelector('[data-current]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [list, pointed, current?.id]);
}
function hasTruncatedText(button: HTMLElement) {
  return [...button.querySelectorAll('span')].some(
    (span) => span.scrollWidth > span.clientWidth,
  );
}
interface RowEvents {
  current?: Row;
  point: (row: Row) => void;
  run: (row: Row) => void;
}
function PaletteRow({ row, events }: { row: Row; events: RowEvents }) {
  const isCurrent = row === events.current;
  return (
    <button
      type="button"
      disabled={row.disabled}
      data-current={isCurrent || undefined}
      onMouseEnter={(event) => {
        const button = event.currentTarget;
        button.title = hasTruncatedText(button) ? row.title : '';
        if (row.disabled || isCurrent) return;
        events.point(row);
      }}
      onClick={() => events.run(row)}
      className={`relative flex h-10 w-full items-center gap-3 rounded px-3 text-sm disabled:opacity-40 ${isCurrent ? selectedRow : ''} ${clickable} ${focusInset}`}
    >
      {isCurrent && <span className={pill} />}
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted dark:text-muted-dark">
        {row.icon}
      </span>
      {row.label}
      {row.trailing}
    </button>
  );
}
function GroupList({ groups, events }: { groups: Group[]; events: RowEvents }) {
  return groups.map((group) => (
    <div key={group.name}>
      <h3 className="flex h-group items-center px-3 text-label font-semibold text-muted dark:text-muted-dark">
        {group.name}
      </h3>
      {group.rows.map((row) => (
        <PaletteRow key={row.id} row={row} events={events} />
      ))}
    </div>
  ));
}
function NoMatches({
  copy,
  filter,
  hint,
}: {
  copy: ModeCopy;
  filter: string;
  hint: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 px-3 py-10 text-center text-sm text-muted dark:text-muted-dark">
      <p>{`No ${copy.noun} matches${filter && ` “${filter}”`}`}</p>
      {hint && <p className="text-meta">{hint}</p>}
    </div>
  );
}
function IgnoredToggle({ ignored }: { ignored: boolean }) {
  return (
    <Button
      variant="icon"
      className="size-8 text-muted aria-pressed:bg-selected aria-pressed:text-accent dark:text-muted-dark dark:aria-pressed:bg-selected-dark dark:aria-pressed:text-accent-dark"
      aria-label="Include ignored files"
      aria-pressed={ignored}
      onClick={() => usePalette.getState().setIgnored(!ignored)}
    >
      {ignored ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
    </Button>
  );
}
interface HeaderProps {
  mode: PaletteMode;
  filter: string;
  ignored: boolean;
  onFilter: (filter: string) => void;
  onKey: (event: KeyboardEvent<HTMLInputElement>) => void;
}
function PaletteHeader({
  mode,
  filter,
  ignored,
  onFilter,
  onKey,
}: HeaderProps) {
  const copy = modes[mode];
  return (
    <div className="flex h-14 items-center gap-3 border-b border-line pr-3 pl-4 dark:border-line-dark">
      <Search className="size-5 shrink-0 text-muted dark:text-muted-dark" />
      <span className="shrink-0 rounded-full bg-hover px-2.5 py-0.5 text-meta font-medium text-muted dark:bg-hover-dark dark:text-muted-dark">
        {copy.chip}
      </span>
      <TextInput
        aria-label={copy.label}
        placeholder={copy.placeholder}
        className="w-full bg-transparent text-base outline-none placeholder:text-muted dark:placeholder:text-muted-dark"
        value={filter}
        onChange={(event) => onFilter(event.target.value)}
        onKeyDown={onKey}
      />
      {mode === 'files' && <IgnoredToggle ignored={ignored} />}
    </div>
  );
}
interface CursorState {
  cursor: PaletteCursor;
  setCursor: Dispatch<SetStateAction<PaletteCursor>>;
}
function usePaletteNavigation(
  { cursor, setCursor }: CursorState,
  enabled: Row[],
) {
  const list = useRef<HTMLDivElement>(null);
  const pointed = useRef(false);
  const current = enabled[Math.min(cursor.index, enabled.length - 1)];
  useScrollToCurrent(list, pointed, current);
  const count = enabled.length;
  return {
    list: list,
    current: current,
    move: (delta: number) =>
      setCursor((latest) => moved(latest, { delta: delta, count: count })),
    page: (direction: number) => {
      const delta = direction * pageStep(list.current);
      setCursor((latest) => paged(latest, { delta: delta, count: count }));
    },
    point: (row: Row) => {
      pointed.current = true;
      setCursor((latest) => pointedAt(latest, enabled.indexOf(row)));
    },
  };
}
function enabledRows(groups: Group[]) {
  const visible = groups.filter((group) => group.rows.length);
  const rows = visible.flatMap((group) => group.rows);
  return {
    visible: visible,
    rows: rows,
    enabled: rows.filter((row) => !row.disabled),
  };
}
export function CommandPalette({ repo }: { repo: string }) {
  const open = usePalette((state) => state.open);
  const mode = usePalette((state) => state.mode);
  const [cursor, setCursor] = useState(emptyCursor);
  const { filter } = cursor;
  const { groups, hint, ignored } = usePaletteGroups(repo, filter);
  const { visible, rows, enabled } = enabledRows(groups);
  const navigation = usePaletteNavigation({ cursor, setCursor }, enabled);
  const { current } = navigation;
  const close = () => {
    setCursor(emptyCursor);
    usePalette.getState().setOpen(false);
  };
  const run = (row: Row) => {
    close();
    row.run();
  };
  return (
    <Modal
      hideChrome
      size="palette"
      title="Command palette"
      open={open}
      onOpenChange={close}
    >
      <PaletteHeader
        mode={mode}
        filter={filter}
        ignored={ignored}
        onFilter={(next) => setCursor(searched(next))}
        onKey={(event) =>
          handleKeyByTable(event, {
            ArrowDown: () => navigation.move(1),
            ArrowUp: () => navigation.move(-1),
            PageDown: () => navigation.page(1),
            PageUp: () => navigation.page(-1),
            Enter: current ? () => run(current) : undefined,
          })
        }
      />
      <div ref={navigation.list} className="max-h-120 overflow-auto p-1.5">
        <GroupList
          groups={visible}
          events={{ current: current, point: navigation.point, run: run }}
        />
        {rows.length === 0 && (
          <NoMatches copy={modes[mode]} filter={filter} hint={hint} />
        )}
      </div>
    </Modal>
  );
}
