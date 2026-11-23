import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { X } from 'lucide-react';
import { useDirty } from '../../stores/editor';
import { fileName } from '../../lib/paths';
import type { SidebarMode } from '../../stores/layout';
import {
  tabKey,
  useActiveTabKey,
  useFileTabs,
  useSelection,
  type FileTab,
} from '../../stores/selection';
import { Button } from '../shared/Button';
import { FileMenu } from '../shared/FileMenu';
import { tabBar, dirtyDot } from '../shared/styles';
import { revealInSidebar } from '../sidebar/reveal';
import { handleKeyByTable, tabKeyHandlers } from '../../lib/keyboard';
import { shortHash } from '../../lib/git';
import { useOpenFile } from '../../lib/open-file';
import { useFileTabLimit } from '../../lib/settings';
export function FileTabStrip({
  repo,
  mode,
}: {
  repo: string;
  mode: SidebarMode;
}) {
  const tabs = useFileTabs(repo, mode);
  const active = useActiveTabKey(repo, mode);
  const openFile = useOpenFile(repo);
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
    const current = Math.max(
      tabs.findIndex((tab) => tabKey(tab.selection) === active),
      0,
    );
    handleKeyByTable(
      event,
      tabKeyHandlers(current, tabs.length, (index) => {
        moved.current = true;
        openFile(tabs[index].selection);
      }),
    );
  };
  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="Open files"
      tabIndex={-1}
      onKeyDown={keydown}
      className="flex h-tab-strip shrink-0 items-end gap-0.5 overflow-x-auto bg-sub pr-2 shadow-rule dark:bg-sub-dark dark:shadow-rule-dark"
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
              ? tab.selection.revision === undefined
                ? tab.selection.source
                : shortHash(tab.selection.revision)
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
  const unsaved = useDirty({ repo: repo, path: path }) && Boolean(editing);
  const tabLimit = useFileTabLimit();
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
    <FileMenu
      repo={repo}
      path={path}
      reveal={() => revealInSidebar(repo, tab.selection, tabLimit)}
    >
      <div
        className={`group relative flex min-w-30 max-w-52 shrink-0 items-center rounded-t pr-1 text-sm first:rounded-tl-none first:border-l-transparent ${active ? `h-8 border border-b-0 border-line bg-surface font-semibold text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark ${tabBar}` : 'mb-px h-7.75 text-muted hover:bg-hover hover:text-ink dark:text-muted-dark dark:hover:bg-hover-dark dark:hover:text-ink-dark'}`}
      >
        <Button
          variant="chrome"
          role="tab"
          aria-selected={active}
          tabIndex={focusable ? 0 : -1}
          title={path}
          {...middle}
          className="min-w-0 flex-1 justify-start gap-1.5 self-stretch rounded-tl pl-2.75"
          onClick={() =>
            useSelection.getState().select(repo, tab.selection, tabLimit)
          }
        >
          <span className="truncate">{name}</span>
          {suffix && (
            <span className="shrink-0 font-mono text-badge text-faint dark:text-faint-dark">
              {suffix}
            </span>
          )}
        </Button>
        <span className="relative grid size-control shrink-0 place-items-center">
          {unsaved && (
            <span
              role="img"
              aria-label="Unsaved edits"
              className={`${dirtyDot} ${active ? 'hidden' : 'group-hover:opacity-0 group-focus-within:opacity-0'}`}
            />
          )}
          <Button
            variant="chrome"
            aria-label={`Close ${name}`}
            {...middle}
            className={`absolute inset-0 rounded hover:bg-hover dark:hover:bg-hover-dark ${active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
            onClick={close}
          >
            <X className="size-3.5" />
          </Button>
        </span>
      </div>
    </FileMenu>
  );
}
