import type { ReactNode } from 'react';
import { ContextMenu } from 'radix-ui';
import { Copy, ExternalLink, FileText, LocateFixed } from 'lucide-react';
import { reportAppError } from '../../lib/ipc';
import { perform } from '../../lib/query';
import { menu, menuItem, menuSeparator } from './styles';
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
  reveal,
  children,
}: {
  repo: string;
  path: string;
  disabled?: boolean;
  reveal?: () => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild disabled={disabled}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={`w-60 ${menu}`}>
          {reveal && (
            <>
              <ContextMenu.Item className={menuItem} onSelect={reveal}>
                <LocateFixed className="size-3.75 text-muted dark:text-muted-dark" />
                Reveal in sidebar
              </ContextMenu.Item>
              <ContextMenu.Separator className={menuSeparator} />
            </>
          )}
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => copy(path.slice(path.lastIndexOf('/') + 1))}
          >
            <FileText className="size-3.75 text-muted dark:text-muted-dark" />
            Copy filename
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => copy(absolutePath(repo, path))}
          >
            <Copy className="size-3.75 text-muted dark:text-muted-dark" />
            Copy path
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Item
            className={menuItem}
            onSelect={() => void perform('system_open', { repo, path })}
          >
            <ExternalLink className="size-3.75 text-muted dark:text-muted-dark" />
            Open in default editor
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
