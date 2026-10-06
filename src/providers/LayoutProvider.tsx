import { useEffect, type ReactNode } from 'react';
import { useFilterStore } from '../stores/filter';
import { useImageViews } from '../stores/image-view';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { useTabs } from '../stores/tabs';
export function LayoutProvider({ children }: { children: ReactNode }) {
  useEffect(
    () =>
      useTabs.subscribe((state, previous) => {
        const open = new Set(state.tabs.flatMap((tab) => tab.members));
        for (const member of previous.tabs.flatMap((tab) => tab.members))
          if (!open.has(member)) {
            useLayout.getState().forget(member);
            useSelection.getState().forget(member);
            useFilterStore.getState().forget(member);
            useImageViews.getState().forget(member);
          }
      }),
    [],
  );
  return <>{children}</>;
}
