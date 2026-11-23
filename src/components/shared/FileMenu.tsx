import type { ReactNode } from 'react';
import { ContextMenu } from 'radix-ui';
import { Copy, ExternalLink, FileText, LocateFixed } from 'lucide-react';
import { invoke, reportAppError } from '../../lib/ipc';
import { perform } from '../../lib/query';
import { absolutePath, fileName } from '../../lib/paths';
import { menu, menuItem, menuSeparator } from './styles';
function copy(text: string) {
  invoke('clipboard_write', { text }).catch(reportAppError);
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
            onSelect={() => copy(fileName(path))}
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
