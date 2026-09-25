import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { X } from 'lucide-react';
import { fileName, useDirty } from '../../stores/editor';
import type { SidebarMode } from '../../stores/layout';
import {
  tabKey,
  useActiveTabKey,
  useFileTabs,
  useSelection,
  type FileTab,
} from '../../stores/selection';
import { Button } from '../shared/Button';
const steps: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};
export function FileTabStrip({
  repo,
  mode,
}: {
  repo: string;
  mode: SidebarMode;
}) {
  const tabs = useFileTabs(repo, mode);
  const active = useActiveTabKey(repo, mode);
  const strip = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    const selected = strip.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (moved.current) selected?.focus();
    moved.current = false;
  }, [active]);
  if (!tabs.length) return null;
  const names = tabs.map((tab) => fileName(tab.selection.path));
  const keydown = (event: KeyboardEvent) => {
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tabKey(tab.selection) === active);
    moved.current = true;
    useSelection
      .getState()
      .select(repo, tabs[step(Math.max(index, 0), tabs.length)].selection);
  };
  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="Open files"
      tabIndex={-1}
      onKeyDown={keydown}
      className="flex h-7.5 shrink-0 items-stretch overflow-x-auto border-b border-line bg-sub dark:border-line-dark dark:bg-sub-dark"
    >
      {tabs.map((tab, index) => (
        <FileTabCell
          key={tabKey(tab.selection)}
          repo={repo}
          mode={mode}
          tab={tab}
          active={tabKey(tab.selection) === active}
          focusable={
            tabKey(tab.selection) === active || (!active && index === 0)
          }
          suffix={
            names.filter((name) => name === names[index]).length > 1
              ? (tab.selection.revision?.slice(0, 7) ?? tab.selection.source)
              : ''
          }
        />
      ))}
    </div>
  );
}
function FileTabCell({
  repo,
  mode,
  tab,
  active,
  focusable,
  suffix,
}: {
  repo: string;
  mode: SidebarMode;
  tab: FileTab;
  active: boolean;
  focusable: boolean;
  suffix: string;
}) {
  const { path, editing } = tab.selection;
  const name = fileName(path);
  const unsaved = useDirty(repo, path) && Boolean(editing);
  const close = () =>
    void useSelection.getState().closeTab(repo, mode, tabKey(tab.selection));
  const middle = {
    onMouseDown: (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button === 1) close();
    },
  };
  return (
    <div
      className={`group relative flex min-w-30 max-w-52 shrink-0 items-center border-r border-line pr-0.5 text-xs dark:border-line-dark ${active ? 'bg-surface text-ink dark:bg-surface-dark dark:text-ink-dark' : 'text-muted hover:bg-track hover:text-ink dark:text-muted-dark dark:hover:bg-track-dark dark:hover:text-ink-dark'}`}
    >
      {active && (
        <span className="absolute inset-x-0 top-0 h-0.5 bg-accent dark:bg-accent-dark" />
      )}
      <Button
        variant="chrome"
        role="tab"
        aria-selected={active}
        tabIndex={focusable ? 0 : -1}
        title={path}
        {...middle}
        className="min-w-0 flex-1 justify-start gap-1.5 self-stretch pl-2.5"
        onClick={() => useSelection.getState().select(repo, tab.selection)}
      >
        <span className="truncate">{name}</span>
        {suffix && (
          <span className="shrink-0 font-mono text-label text-faint dark:text-faint-dark">
            {suffix}
          </span>
        )}
      </Button>
      <span className="relative grid size-control shrink-0 place-items-center">
        {unsaved && (
          <span
            role="img"
            aria-label="Unsaved edits"
            className={`size-2 rounded-full bg-modified dark:bg-modified-dark ${active ? 'hidden' : 'group-hover:opacity-0 group-focus-within:opacity-0'}`}
          />
        )}
        <Button
          variant="chrome"
          aria-label={`Close ${name}`}
          {...middle}
          className={`absolute inset-0 ${active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
          onClick={close}
        >
          <X className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}
