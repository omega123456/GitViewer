import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from './Button';
import { focus } from './styles';
const sizes = {
  dialog: 'top-1/4 w-dialog shadow-xl',
  palette: 'top-24 w-dialog-wide shadow-2xl animate-rise',
  settings:
    'top-1/2 -translate-y-1/2 w-settings-width h-settings-height max-h-full shadow-xl',
};
export function Modal({
  title,
  open,
  hideChrome,
  focusId,
  size = 'dialog',
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  hideChrome?: boolean;
  focusId?: string;
  size?: keyof typeof sizes;
  onOpenChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            const target = focusId && document.getElementById(focusId);
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          className={`fixed left-1/2 z-50 max-w-full -translate-x-1/2 overflow-hidden rounded-md border border-line bg-surface text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark ${sizes[size]} ${hideChrome ? '' : 'p-5'} ${focus}`}
        >
          {hideChrome ? (
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
          ) : (
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold">
                {title}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button aria-label="Close dialog">
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
          )}
          <Dialog.Description className="sr-only">
            {title} options
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
