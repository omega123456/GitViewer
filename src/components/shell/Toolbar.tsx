import { TextInput } from '../shared/TextInput';
import {
  Archive,
  Command,
  Download,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { perform } from '../../lib/query';
import { runs, useCurrentActivity } from '../../stores/activity';
import { useActionRegistry } from '../../lib/actions';
import { shortcutLabel, type Action } from '../../lib/keyboard';
import type { Status } from '../../lib/types';
import { useFilter, useFilterStore } from '../../stores/filter';
import { usePalette } from '../../stores/palette';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
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
export function Toolbar({
  repo,
  status,
  disabled,
  actions,
}: {
  repo: string;
  status: Status;
  disabled: boolean;
  actions: Action[];
}) {
  const filter = useFilter(repo);
  const activity = useCurrentActivity(repo);
  const stashing = runs(activity, 'stash_save');
  const palette = useActionRegistry((state) =>
    state.scopes.app?.find((action) => action.id === 'palette'),
  );
  return (
    <div className="flex h-toolbar shrink-0 items-center gap-1 border-b border-line bg-sub px-2.5 dark:border-line-dark dark:bg-sub-dark">
      <BranchPopover repo={repo} status={status} disabled={disabled} />
      <Divider />
      <div className="flex items-center gap-1">
        {(['fetch', 'pull', 'push'] as const).map((id) => {
          const action = actions.find((action) => action.id === id)!;
          const count = id === 'pull' ? status.behind : status.ahead;
          const running = runs(activity, 'sync', { action: id });
          return (
            <Button
              key={id}
              variant="command"
              aria-busy={running}
              disabled={action.disabled}
              onClick={() => void action.run()}
            >
              {running ? <Spinner /> : icons[id]}
              <span className="capitalize">{id}</span>
              {id !== 'fetch' && Boolean(count) && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-badge font-semibold text-on-accent dark:bg-accent-dark dark:text-on-accent-dark">
                  {count}
                </span>
              )}
            </Button>
          );
        })}
      </div>
      <Divider />
      <Button
        variant="command"
        aria-busy={stashing}
        disabled={disabled}
        title="Stash changes"
        onClick={() =>
          void perform('stash_save', {
            repo,
            message: 'Saved from GitViewer',
          })
        }
      >
        {stashing ? <Spinner /> : <Archive className="size-4" />}
        <span>Stash</span>
      </Button>
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
    </div>
  );
}
