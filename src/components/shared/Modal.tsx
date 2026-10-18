import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { focus } from './styles';
const surface =
  'border-line bg-surface dark:border-line-dark dark:bg-surface-dark';
const sizes = {
  dialog: `top-1/4 w-dialog max-w-full ${surface}`,
  palette: `top-24 w-fit min-w-palette-floor max-w-palette-cap animate-rise ${surface}`,
  settings:
    'top-1/2 -translate-y-1/2 w-settings-width h-settings-height max-w-full max-h-full border-window-stroke bg-chrome dark:border-window-stroke-dark dark:bg-chrome-dark',
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
  footer,
  children,
}: {
  title: string;
  open: boolean;
  hideChrome?: boolean;
  focusId?: string;
  size?: keyof typeof sizes;
  onOpenChange: (value: boolean) => void;
  footer?: ReactNode;
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
          className={`fixed inset-x-0 z-50 mx-auto overflow-hidden rounded-md border text-ink shadow-dialog dark:text-ink-dark ${sizes[size]} ${focus}`}
        >
          <Dialog.Description className="sr-only">
            {title} options
          </Dialog.Description>
          {hideChrome ? (
            <>
              <Dialog.Title className="sr-only">{title}</Dialog.Title>
              {children}
            </>
          ) : (
            <div className="flex flex-col gap-3 px-6 py-5.5">
              <Dialog.Title className="text-subtitle font-semibold">
                {title}
              </Dialog.Title>
              {children}
            </div>
          )}
          {footer && (
            <div className="grid grid-cols-2 gap-2 border-t border-line bg-sub px-6 py-5 dark:border-line-dark dark:bg-sub-dark">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
