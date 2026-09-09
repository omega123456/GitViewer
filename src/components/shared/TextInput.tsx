import type { ComponentPropsWithRef } from 'react';

export function TextInput(props: ComponentPropsWithRef<'input'>) {
  return (
    <input
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      {...props}
    />
  );
}
