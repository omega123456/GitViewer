import { useLayout, useTabLayout, type SidebarMode } from '../../stores/layout';
import { ViewSwitch } from '../shared/ViewSwitch';
import { openCompare } from './CompareSection';
type SidebarOption = 'working tree' | 'history' | 'compare';
const options: SidebarOption[] = ['working tree', 'history', 'compare'];
const optionOfMode: Record<SidebarMode, SidebarOption> = {
  working: 'working tree',
  history: 'history',
  compare: 'compare',
};
const openOption: Record<SidebarOption, (repo: string) => void> = {
  'working tree': (repo) =>
    useLayout.getState().update(repo, { mode: 'working' }),
  history: (repo) => useLayout.getState().update(repo, { mode: 'history' }),
  compare: (repo) => openCompare(repo),
};
export function SidebarModeToggle({ repo }: { repo: string }) {
  const { mode } = useTabLayout(repo);
  return (
    <div className="shrink-0 border-b border-line bg-sub px-1.5 py-1 dark:border-line-dark dark:bg-sub-dark">
      <ViewSwitch
        stretch
        label="Sidebar mode"
        value={optionOfMode[mode]}
        options={options}
        onChange={(option) => openOption[option](repo)}
      />
    </div>
  );
}
