import type { ReactNode } from 'react';
import { LucideProvider } from 'lucide-react';
import { SessionProvider } from './SessionProvider';
import { CommandProvider } from './CommandProvider';
import { LayoutProvider } from './LayoutProvider';
import { QueryProvider } from './QueryProvider';
import { ThemeProvider } from './ThemeProvider';
export function Providers({ children }: { children: ReactNode }) {
  return (
    <LucideProvider strokeWidth={1.5}>
      <QueryProvider>
        <ThemeProvider>
          <LayoutProvider>
            <SessionProvider>
              <CommandProvider>{children}</CommandProvider>
            </SessionProvider>
          </LayoutProvider>
        </ThemeProvider>
      </QueryProvider>
    </LucideProvider>
  );
}
