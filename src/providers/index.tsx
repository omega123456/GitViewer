import type { ReactNode } from 'react';
import { SessionProvider } from './SessionProvider';
import { CommandProvider } from './CommandProvider';
import { LayoutProvider } from './LayoutProvider';
import { QueryProvider } from './QueryProvider';
import { ThemeProvider } from './ThemeProvider';
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <LayoutProvider>
          <SessionProvider>
            <CommandProvider>{children}</CommandProvider>
          </SessionProvider>
        </LayoutProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
