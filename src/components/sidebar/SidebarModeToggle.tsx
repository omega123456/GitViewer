import { History, ListChecks } from 'lucide-react';
import { useLayout, useTabLayout } from '../../stores/layout';
import { Segment } from '../shared/Segment';
export function SidebarModeToggle({ repo }: { repo: string }) {
  const { history } = useTabLayout(repo);
  return (
    <div className="shrink-0 border-b border-line bg-chrome p-1 dark:border-line-dark dark:bg-chrome-dark">
      <Segment
        stretch
        label="Sidebar mode"
        value={history ? 'history' : 'working tree'}
        options={['working tree', 'history']}
        icons={{
          'working tree': <ListChecks className="size-3" />,
          history: <History className="size-3" />,
        }}
        onChange={(value) =>
          useLayout.getState().update(repo, { history: value === 'history' })
        }
      />
    </div>
  );
}
