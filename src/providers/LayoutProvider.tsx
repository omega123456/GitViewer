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
        for (const tab of previous.tabs)
          if (!state.tabs.some((open) => open.id === tab.id)) {
            useLayout.getState().forget(tab.id);
            useSelection.getState().forget(tab.id);
            useFilterStore.getState().forget(tab.id);
            useImageViews.getState().forget(tab.id);
          }
      }),
    [],
  );
  return <>{children}</>;
}
