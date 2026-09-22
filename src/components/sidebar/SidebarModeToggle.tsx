import { GitCompare, History, ListChecks } from 'lucide-react';
import { useLayout, useTabLayout } from '../../stores/layout';
import { Segment } from '../shared/Segment';
import { openCompare } from './CompareSection';
export function SidebarModeToggle({ repo }: { repo: string }) {
  const { mode } = useTabLayout(repo);
  return (
    <div className="shrink-0 border-b border-line bg-chrome p-1 dark:border-line-dark dark:bg-chrome-dark">
      <Segment
        stretch
        label="Sidebar mode"
        value={mode === 'working' ? 'working tree' : mode}
        options={['working tree', 'history', 'compare']}
        icons={{
          'working tree': <ListChecks className="size-3" />,
          history: <History className="size-3" />,
          compare: <GitCompare className="size-3" />,
        }}
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
