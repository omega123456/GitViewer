import { useLayout, useTabLayout } from '../../stores/layout';
import { ViewSwitch } from '../shared/ViewSwitch';
import { openCompare } from './CompareSection';
export function SidebarModeToggle({ repo }: { repo: string }) {
  const { mode } = useTabLayout(repo);
  return (
    <div className="shrink-0 border-b border-line bg-sub px-1.5 py-1 dark:border-line-dark dark:bg-sub-dark">
      <ViewSwitch
        stretch
        label="Sidebar mode"
        value={mode === 'working' ? 'working tree' : mode}
        options={['working tree', 'history', 'compare']}
        onChange={(value) => {
          if (value === 'compare') openCompare(repo);
          else
            useLayout
              .getState()
              .update(repo, { mode: value === 'history' ? value : 'working' });
        }}
      />
    </div>
  );
}
