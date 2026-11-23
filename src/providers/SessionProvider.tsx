import { useEffect, useState, type ReactNode } from 'react';
import { startSession } from '../lib/session';
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => startSession(() => setReady(true)), []);
  return ready ? children : null;
}
