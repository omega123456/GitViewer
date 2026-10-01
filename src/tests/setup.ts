import './renders';
import '@testing-library/jest-dom/vitest';
import './harness';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { client } from '../lib/query';
import { useTabs } from '../stores/tabs';
import { useActivity } from '../stores/activity';
import { useErrors } from '../stores/errors';
import { useSuccesses } from '../stores/successes';
import { useDecision } from '../stores/decision';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { useFilterStore } from '../stores/filter';
import { useDiffView } from '../stores/diff-view';
import { useEditor } from '../stores/editor';
import { useImageViews } from '../stores/image-view';
import { usePalette } from '../stores/palette';
import { useSettingsNav } from '../stores/settings-nav';
import { useCommit } from '../stores/commit';
import { useGenerate } from '../stores/generate';
import { useTheme } from '../stores/theme';
import { useDensity } from '../stores/density';
import { useUpdate } from '../stores/update';
import { resetHarness } from './harness';
import { renders } from './renders';
import { terminate } from '../lib/highlight';
import {
  highlightWorker,
  type Job,
  type Reply,
  type Request,
} from '../lib/highlight.worker';
vi.mock('shiki', async (importOriginal) => {
  const shiki = await importOriginal<typeof import('shiki')>();
  let shared: ReturnType<typeof shiki.createHighlighter> | undefined;
  return {
    ...shiki,
    createHighlighter: (
      options: Parameters<typeof shiki.createHighlighter>[0],
    ) => (shared ??= shiki.createHighlighter(options)),
  };
});
const rect = {
  width: 800,
  height: 600,
  top: 0,
  left: 0,
  right: 800,
  bottom: 600,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};
const flat = (): DOMRect => rect as DOMRect;
export const geometry: { rect: (element: Element) => DOMRect } = {
  rect: flat,
};
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  value(this: HTMLElement) {
    return geometry.rect(this);
  },
});
Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  value: () => rect,
});
Object.defineProperty(Range.prototype, 'getClientRects', {
  value: () => [],
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  get: () => 600,
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => 800 });
Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn() });
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
});
const capturedPointers = new WeakMap<HTMLElement, number>();
vi.stubGlobal('PointerEvent', MouseEvent);
Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
  value: function (this: HTMLElement, id: number) {
    return capturedPointers.has(this) && capturedPointers.get(this) === id;
  },
});
Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
  value: function (this: HTMLElement, id: number) {
    capturedPointers.set(this, id);
  },
});
Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
  value: function (this: HTMLElement) {
    capturedPointers.delete(this);
  },
});
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
type Report = (entries: { isIntersecting: boolean }[]) => void;
const reports = new Map<Element, Map<string, Report>>();
export const intersecting = { initially: true };
export function intersect(target: Element, visible: boolean, margin = '400px') {
  reports.get(target)?.get(margin)?.([{ isIntersecting: visible }]);
}
vi.stubGlobal(
  'IntersectionObserver',
  class {
    private targets = new Set<Element>();
    private margin: string;
    constructor(
      private callback: Report,
      options?: { rootMargin?: string },
    ) {
      this.margin = options?.rootMargin ?? '';
    }
    observe(target: Element) {
      this.targets.add(target);
      const group = reports.get(target) ?? new Map<string, Report>();
      group.set(this.margin, this.callback);
      reports.set(target, group);
      this.callback([{ isIntersecting: intersecting.initially }]);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
      reports.get(target)?.delete(this.margin);
    }
    disconnect() {
      this.targets.forEach((target) =>
        reports.get(target)?.delete(this.margin),
      );
      this.targets.clear();
    }
  },
);
function later(run: () => void) {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    run();
  };
  channel.port2.postMessage(null);
}
export const workers = {
  created: 0,
  jobs: [] as Job[],
  cancels: [] as number[],
  held: false,
  queued: [] as (() => void)[],
  failing: false,
  live: undefined as HighlightWorkerStub | undefined,
};
export function release(count = Infinity) {
  workers.queued.splice(0, count).forEach(later);
}
class HighlightWorkerStub extends EventTarget {
  private handler = highlightWorker((reply) => this.reply(reply));
  private open = new Set<number>();
  private stopped = false;
  constructor() {
    super();
    workers.created += 1;
    workers.live = this;
  }
  postMessage(message: Request) {
    if (message.type === 'cancel') {
      workers.cancels.push(message.id);
      this.open.delete(message.id);
    } else {
      workers.jobs.push(message);
      this.open.add(message.id);
    }
    if (message.type === 'job' && workers.failing) {
      this.reply({ id: message.id, failed: true });
      return;
    }
    later(() => {
      if (!this.stopped) this.handler.receive(message);
    });
  }
  private reply(message: Reply) {
    if ('failed' in message || message.done) this.open.delete(message.id);
    const deliver = () => {
      if (!this.stopped)
        this.dispatchEvent(new MessageEvent('message', { data: message }));
    };
    if (workers.held) workers.queued.push(deliver);
    else later(deliver);
  }
  terminate() {
    this.stopped = true;
    this.open.forEach((id) => this.handler.receive({ type: 'cancel', id }));
    this.open.clear();
    if (workers.live === this) workers.live = undefined;
  }
  fail(type: 'error' | 'messageerror') {
    this.dispatchEvent(new Event(type));
  }
  languages() {
    return this.handler.languages();
  }
}
vi.stubGlobal('Worker', HighlightWorkerStub);
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));
beforeEach(() => {
  resetHarness();
  renders.reset();
  Object.assign(workers, {
    created: 0,
    jobs: [],
    cancels: [],
    held: false,
    queued: [],
    failing: false,
  });
  reports.clear();
  intersecting.initially = true;
  useUpdate.setState({ dismissedVersion: null });
  client.clear();
  useTabs.setState({ tabs: [], active: '' });
  useActivity.setState({ scopes: {} });
  useErrors.setState({ scopes: {} });
  useSuccesses.setState({ scopes: {} });
  useDecision.setState({ pending: {} });
  useLayout.setState({ tabs: {} });
  useSelection.setState({
    working: {},
    history: {},
    compare: {},
    all: {},
    paths: {},
    tabs: { working: {}, history: {}, compare: {} },
  });
  useFilterStore.setState({ text: {} });
  useDiffView.setState({ mode: null });
  useEditor.setState({ buffers: {} });
  useImageViews.setState({ tabs: {} });
  usePalette.setState({ open: false, settings: false, ignored: null });
  useSettingsNav.setState({ pane: 'general' });
  useGenerate.setState({ repos: {} });
  useCommit.setState({ repos: {} });
  useTheme.setState({ preference: 'system', system: false });
  useDensity.setState({ density: 'comfortable' });
});
afterEach(() => {
  cleanup();
  geometry.rect = flat;
  terminate();
  client.clear();
  vi.useRealTimers();
});
