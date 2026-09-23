import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from './Button';
import { focus } from './styles';
const sizes = {
  dialog: 'top-1/4 w-dialog max-w-full shadow-xl',
  palette:
    'top-24 w-fit min-w-palette-floor max-w-palette-cap shadow-2xl animate-rise',
  settings:
    'top-1/2 -translate-y-1/2 w-settings-width h-settings-height max-w-full max-h-full shadow-xl',
};
function useSizeTransition(enabled: boolean) {
  const element = useRef<HTMLDivElement | null>(null);
  const settled = useRef<DOMRect | null>(null);
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const target = element.current;
    if (!enabled || !target) return;
    const from = running.current
      ? target.getBoundingClientRect()
      : settled.current;
    running.current?.cancel();
    running.current = null;
    const to = target.getBoundingClientRect();
    settled.current = to;
    if (!from || (from.width === to.width && from.height === to.height)) return;
    const animation = target.animate(
      [
        { width: `${from.width}px`, height: `${from.height}px` },
        { width: `${to.width}px`, height: `${to.height}px` },
      ],
      { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    animation.onfinish = () => {
      if (running.current === animation) running.current = null;
    };
    running.current = animation;
  });
  return useCallback((node: HTMLDivElement | null) => {
    element.current = node;
    running.current = null;
    settled.current = node?.getBoundingClientRect() ?? null;
  }, []);
}
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
  const content = useSizeTransition(open && size === 'palette');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          ref={content}
          onOpenAutoFocus={(event) => {
            const target = focusId && document.getElementById(focusId);
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          className={`fixed inset-x-0 z-50 mx-auto overflow-hidden rounded-md border border-line bg-surface text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark ${sizes[size]} ${hideChrome ? '' : 'p-5'} ${focus}`}
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
