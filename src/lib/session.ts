import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import { invoke, reportAppError } from './ipc';
import { joinProject } from './repository';
import type { Repository, Session } from './types';
import { unsavedNames, useEditor } from '../stores/editor';
import { tabLayout, useLayout } from '../stores/layout';
import { activeView, useTabs, type TabsState } from '../stores/tabs';
const LAYOUT_SAVE_DELAY_MS = 200;
const NAME_SEPARATOR = '\n';
type Stop = () => void;
export type SessionTab = Session['tabs'][number];
export interface RestoredTab {
  tab: SessionTab;
  repo: Repository;
}
export interface Teardown {
  readonly stopped: boolean;
  add: (stop: Stop) => void;
  stop: () => void;
}
interface SessionRun {
  teardown: Teardown;
  queue: Promise<void>;
  closing: boolean;
  asking: boolean;
  reported: string;
  settle: ReturnType<typeof setTimeout> | undefined;
}
export function createTeardown(): Teardown {
  let stopped = false;
  const stops: Stop[] = [];
  return {
    get stopped() {
      return stopped;
    },
    add: (stop) => {
      if (stopped) return stop();
      stops.push(stop);
    },
    stop: () => {
      stopped = true;
      stops.splice(0).forEach((pending) => pending());
    },
  };
}
function reportUnlessStopped(run: SessionRun, error: unknown) {
  if (!run.teardown.stopped) reportAppError(error);
}
export function snapshotSession(): Session {
  const state = useTabs.getState();
  return {
    tabs: state.tabs.flatMap((tab) =>
      tab.members.map((member) => ({
        path: member,
        message: state.messages[member] ?? '',
        layout: tabLayout(member),
        shown: member === tab.view,
      })),
    ),
    active: activeView(),
  };
}
export function activeAfterRestore(
  session: Session,
  restored: RestoredTab[],
): string | undefined {
  const latest = restored.at(-1)?.repo.project;
  if (!latest) return undefined;
  const matching = restored.filter(({ tab }) => tab.path === session.active);
  const wanted = matching.at(-1)?.repo.project ?? session.active;
  const isOpen = useTabs.getState().tabs.some((tab) => tab.id === wanted);
  return isOpen ? wanted : latest;
}
function restoreTab({ tab, repo }: RestoredTab) {
  joinProject(repo);
  if (tab.shown) useTabs.getState().show(repo.project, repo.id);
  useTabs.getState().setMessage(repo.id, tab.message);
  if (tab.layout) useLayout.getState().update(repo.id, tab.layout);
}
function restoredTabs(
  session: Session,
  results: PromiseSettledResult<Repository>[],
) {
  return results.flatMap((result, index): RestoredTab[] => {
    if (result.status === 'rejected') {
      reportAppError(result.reason);
      return [];
    }
    const restored = { tab: session.tabs[index], repo: result.value };
    restoreTab(restored);
    return [restored];
  });
}
async function restoreTabs(run: SessionRun) {
  const session = await invoke('session_get', {});
  const results = await Promise.allSettled(
    session.tabs.map((tab) => invoke('repo_open', { path: tab.path })),
  );
  if (run.teardown.stopped) return;
  const active = activeAfterRestore(session, restoredTabs(session, results));
  if (active) useTabs.getState().activate(active);
}
function enqueue(run: SessionRun, write: () => Promise<void>) {
  run.queue = run.queue.then(write);
}
function saveSession(run: SessionRun) {
  if (run.closing) return;
  const session = snapshotSession();
  enqueue(run, async () => {
    try {
      await invoke('session_set', session);
    } catch (error) {
      reportUnlessStopped(run, error);
    }
  });
}
function closeSession(run: SessionRun) {
  if (run.closing || run.teardown.stopped) return;
  run.closing = true;
  const session = snapshotSession();
  enqueue(run, async () => {
    try {
      await invoke('session_close', session);
    } catch (error) {
      run.closing = false;
      reportUnlessStopped(run, error);
    }
  });
}
function quitApproved(names: string[]) {
  if (!names.length) return Promise.resolve(true);
  return confirm(`Quit and discard unsaved edits to ${names.join(', ')}?`, {
    title: 'Unsaved edits',
  });
}
async function confirmQuit(run: SessionRun) {
  if (run.asking) return;
  run.asking = true;
  try {
    if (await quitApproved(unsavedNames())) await invoke('quit', {});
  } catch (error) {
    reportAppError(error);
  } finally {
    run.asking = false;
  }
}
function listening(run: SessionRun, registration: Promise<Stop>) {
  return registration.catch((error) => {
    reportUnlessStopped(run, error);
    return () => {};
  });
}
async function listenForShutdown(run: SessionRun) {
  const stops = await Promise.all([
    listening(
      run,
      listen('session://close-cancelled', () => {
        run.closing = false;
      }),
    ),
    listening(
      run,
      listen('session://save-requested', () => closeSession(run)),
    ),
    listening(
      run,
      listen('session://unsaved-edits', () => void confirmQuit(run)),
    ),
  ]);
  stops.forEach(run.teardown.add);
}
function tabsChanged(state: TabsState, previous: TabsState) {
  const sameTabs = state.tabs === previous.tabs;
  const sameActive = state.active === previous.active;
  const sameMessages = state.messages === previous.messages;
  return !(sameTabs && sameActive && sameMessages);
}
function reportUnsaved(run: SessionRun) {
  const names = unsavedNames();
  const joined = names.join(NAME_SEPARATOR);
  if (joined === run.reported) return;
  run.reported = joined;
  invoke('unsaved_set', { paths: names }).catch(reportAppError);
}
function saveLayoutSoon(run: SessionRun) {
  clearTimeout(run.settle);
  run.settle = setTimeout(() => saveSession(run), LAYOUT_SAVE_DELAY_MS);
}
function subscribeToStores(run: SessionRun) {
  run.teardown.add(
    useTabs.subscribe((state, previous) => {
      if (tabsChanged(state, previous)) saveSession(run);
    }),
  );
  run.teardown.add(useEditor.subscribe(() => reportUnsaved(run)));
  run.teardown.add(useLayout.subscribe(() => saveLayoutSoon(run)));
}
async function runSession(run: SessionRun, onReady: () => void) {
  try {
    await restoreTabs(run);
  } catch (error) {
    reportUnlessStopped(run, error);
  }
  if (run.teardown.stopped) return;
  await listenForShutdown(run);
  if (run.teardown.stopped) return;
  subscribeToStores(run);
  onReady();
}
export function startSession(onReady: () => void) {
  const run: SessionRun = {
    teardown: createTeardown(),
    queue: Promise.resolve(),
    closing: false,
    asking: false,
    reported: '',
    settle: undefined,
  };
  run.teardown.add(() => clearTimeout(run.settle));
  void runSession(run, onReady);
  return run.teardown.stop;
}
