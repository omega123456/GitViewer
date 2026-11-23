import { TextInput } from '../shared/TextInput';
import {
  Archive,
  Command,
  Download,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { runs, useCurrentActivity } from '../../stores/activity';
import { useActionRegistry } from '../../lib/actions';
import { shortcutLabel, type Action } from '../../lib/keyboard';
import type { Status } from '../../lib/types';
import { useFilter, useFilterStore } from '../../stores/filter';
import { usePalette } from '../../stores/palette';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { BusyIcon } from '../shared/BusyIcon';
import { searchBox, searchInput } from '../shared/styles';
import { BranchPopover } from './BranchPopover';
const icons = {
  fetch: <RefreshCw className="size-4" />,
  pull: <Download className="size-4" />,
  push: <Upload className="size-4" />,
};
function Divider() {
  return (
    <span className="mx-1.5 h-5 w-px shrink-0 bg-line dark:bg-line-dark" />
  );
}
type SyncId = keyof typeof icons;
const syncIds: SyncId[] = ['fetch', 'pull', 'push'];
interface ToolbarProps {
  repo: string;
  status: Status;
  disabled: boolean;
  actions: Action[];
}
function actionById(actions: Action[], id: string) {
  return actions.find((action) => action.id === id);
}
function SyncButton({ props, id }: { props: ToolbarProps; id: SyncId }) {
  const { repo, status, actions } = props;
  const activity = useCurrentActivity(repo);
  const action = actionById(actions, id);
  if (!action) return null;
  const count = id === 'pull' ? status.behind : status.ahead;
  const counted = id !== 'fetch' && Boolean(count);
  const running = runs(activity, 'sync', { action: id });
  return (
    <Button
      variant="command"
      aria-busy={running}
      disabled={action.disabled}
      onClick={() => void action.run()}
    >
      {running ? <Spinner /> : icons[id]}
      <span className="capitalize">{id}</span>
      {counted && (
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-badge font-semibold text-on-accent dark:bg-accent-dark dark:text-on-accent-dark">
          {count}
        </span>
      )}
    </Button>
  );
}
function StashButton({ props }: { props: ToolbarProps }) {
  const stashing = runs(useCurrentActivity(props.repo), 'stash_save');
  const stash = actionById(props.actions, 'stash');
  if (!stash) return null;
  return (
    <Button
      variant="command"
      aria-busy={stashing}
      disabled={stash.disabled}
      title="Stash changes"
      onClick={() => void stash.run()}
    >
      <BusyIcon busy={stashing} icon={Archive} />
      <span>Stash</span>
    </Button>
  );
}
function FilterField({ repo }: { repo: string }) {
  const filter = useFilter(repo);
  return (
    <label className={`ml-auto h-8 w-57.5 ${searchBox}`}>
      <Search className="size-3.5 shrink-0 text-muted dark:text-muted-dark" />
      <TextInput
        aria-label="Filter files"
        placeholder="Filter files…"
        className={searchInput}
        value={filter}
        onChange={(event) =>
          useFilterStore.getState().set(repo, event.target.value)
        }
      />
    </label>
  );
}
function PaletteButton() {
  const palette = useActionRegistry((state) =>
    state.scopes.app?.find((action) => action.id === 'palette'),
  );
  return (
    <Button
      title="Command palette"
      variant="command"
      className="ml-1 gap-2"
      onClick={() => usePalette.getState().setOpen(true)}
    >
      <Command className="size-4" />
      {palette && (
        <kbd className="font-sans text-label font-medium text-muted dark:text-muted-dark">
          {shortcutLabel(palette.key)}
        </kbd>
      )}
    </Button>
  );
}
export function Toolbar(props: ToolbarProps) {
  const { repo, status, disabled } = props;
  return (
    <div className="flex h-toolbar shrink-0 items-center gap-1 border-b border-line bg-sub px-2.5 dark:border-line-dark dark:bg-sub-dark">
      <BranchPopover repo={repo} status={status} disabled={disabled} />
      <Divider />
      <div className="flex items-center gap-1">
        {syncIds.map((id) => (
          <SyncButton key={id} props={props} id={id} />
        ))}
      </div>
      <Divider />
      <StashButton props={props} />
      <FilterField repo={repo} />
      <PaletteButton />
    </div>
  );
}
