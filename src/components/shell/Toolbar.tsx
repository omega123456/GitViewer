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
import { useActionRegistry } from '../../lib/actions';
import { shortcutLabel, type Action } from '../../lib/keyboard';
import type { Status } from '../../lib/types';
import { useFilter, useFilterStore } from '../../stores/filter';
import { usePalette } from '../../stores/palette';
import { Button } from '../shared/Button';
import { BranchPopover } from './BranchPopover';
const icons = {
  fetch: <RefreshCw className="size-3.5" />,
  pull: <Download className="size-3.5" />,
  push: <Upload className="size-3.5" />,
};
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
  const palette = useActionRegistry((state) =>
    state.scopes.app?.find((action) => action.id === 'palette'),
  );
  return (
    <div className="flex h-toolbar shrink-0 items-center gap-2 border-b border-line bg-chrome px-3 dark:border-line-dark dark:bg-chrome-dark">
      <BranchPopover repo={repo} status={status} disabled={disabled} />
      {(['fetch', 'pull', 'push'] as const).map((id) => {
        const action = actions.find((action) => action.id === id)!;
        return (
          <Button
            key={id}
            disabled={action.disabled}
            onClick={() => void action.run()}
          >
            {icons[id]}
            <span className="capitalize">{id}</span>
            <span className="text-label text-muted">
              {id === 'pull'
                ? status.behind
                : id === 'push'
                  ? status.ahead
                  : ''}
            </span>
          </Button>
        );
      })}
      <Button
        disabled={disabled}
        title="Stash changes"
        onClick={() =>
          void perform('stash_save', {
            repo,
            message: 'Saved from GitViewer',
          })
        }
      >
        <Archive className="size-3.5" />
      </Button>
      <div className="ml-auto flex items-center gap-2 rounded border border-line bg-surface px-2 dark:border-line-dark dark:bg-surface-dark">
        <Search className="size-3.5 text-faint dark:text-faint-dark" />
        <TextInput
          aria-label="Filter files"
          placeholder="Filter files…"
          className="w-40 bg-transparent py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent"
          value={filter}
          onChange={(event) =>
            useFilterStore.getState().set(repo, event.target.value)
          }
        />
      </div>
      <Button
        title="Command palette"
        className="border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
        onClick={() => usePalette.getState().setOpen(true)}
      >
        <Command className="size-3.5 text-faint dark:text-faint-dark" />
        {palette && (
          <kbd className="rounded-xs border border-line bg-sub px-1 font-mono text-label text-muted dark:border-line-dark dark:bg-sub-dark">
            {shortcutLabel(palette.key)}
          </kbd>
        )}
      </Button>
    </div>
  );
}
