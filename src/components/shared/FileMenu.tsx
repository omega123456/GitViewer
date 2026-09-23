import type { ReactNode } from 'react';
import { ContextMenu } from 'radix-ui';
import { Copy, ExternalLink, FileText } from 'lucide-react';
import { reportAppError } from '../../lib/ipc';
import { perform } from '../../lib/query';
import { focus } from './styles';
const item = `flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs outline-none data-highlighted:bg-hover dark:data-highlighted:bg-hover-dark ${focus}`;
export function absolutePath(repo: string, path: string) {
  const root = repo.replace(/^\\\\\?\\/, '');
  return root.includes('\\')
    ? `${root}\\${path.replaceAll('/', '\\')}`
    : `${root}/${path}`;
}
function copy(text: string) {
  navigator.clipboard.writeText(text).catch(reportAppError);
}
export function FileMenu({
  repo,
  path,
  disabled = false,
  children,
}: {
  repo: string;
  path: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild disabled={disabled}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-40 flex w-52 flex-col rounded-md border border-line bg-surface p-1 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark">
          <ContextMenu.Item
            className={item}
            onSelect={() => copy(path.slice(path.lastIndexOf('/') + 1))}
          >
            <FileText className="size-3" />
            Copy filename
          </ContextMenu.Item>
          <ContextMenu.Item
            className={item}
            onSelect={() => copy(absolutePath(repo, path))}
          >
            <Copy className="size-3" />
            Copy path
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-line dark:bg-line-dark" />
          <ContextMenu.Item
            className={item}
            onSelect={() => void perform('system_open', { repo, path })}
          >
            <ExternalLink className="size-3" />
            Open in default editor
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
