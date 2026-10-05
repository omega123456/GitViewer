import type { ComponentPropsWithRef } from 'react';

export function TextArea(props: ComponentPropsWithRef<'textarea'>) {
  return (
    <textarea
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      {...props}
      className={`overflow-x-hidden wrap-anywhere ${props.className ?? ''}`}
    />
  );
}
