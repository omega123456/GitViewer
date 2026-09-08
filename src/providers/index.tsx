import type { ReactNode } from 'react';
import { CommandProvider } from './CommandProvider';
import { LayoutProvider } from './LayoutProvider';
import { QueryProvider } from './QueryProvider';
import { ThemeProvider } from './ThemeProvider';
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <LayoutProvider>
          <CommandProvider>{children}</CommandProvider>
        </LayoutProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
