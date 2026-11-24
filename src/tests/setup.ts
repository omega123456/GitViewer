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
import { useSystemTheme } from '../stores/theme';
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

export const VIEWPORT_WIDTH = 800;
export const VIEWPORT_HEIGHT = 600;

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

export function domRect(dimensions: {
  x?: number;
  y?: number;
  width: number;
  height: number;
}): DOMRect {
  return new DOMRect(
    dimensions.x ?? 0,
    dimensions.y ?? 0,
    dimensions.width,
    dimensions.height,
  );
}

const defaultRect = domRect({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
const flat = (): DOMRect => defaultRect;

export const geometry: { rect: (element: Element) => DOMRect } = {
  rect: flat,
};

Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  value(this: HTMLElement) {
    return geometry.rect(this);
  },
});
Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  value: () => defaultRect,
});
Object.defineProperty(Range.prototype, 'getClientRects', {
  value: () => [],
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  get: () => VIEWPORT_HEIGHT,
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  get: () => VIEWPORT_WIDTH,
});
Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn() });
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
});

const capturedPointers = new WeakMap<HTMLElement, number>();
vi.stubGlobal('PointerEvent', MouseEvent);
Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
  value(this: HTMLElement, id: number) {
    return capturedPointers.has(this) && capturedPointers.get(this) === id;
  },
});
Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
  value(this: HTMLElement, id: number) {
    capturedPointers.set(this, id);
  },
});
Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
  value(this: HTMLElement) {
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

interface WorkerTracker {
  created: number;
  jobs: Job[];
  cancels: number[];
  held: boolean;
  queued: (() => void)[];
  failing: boolean;
  live: HighlightWorkerStub | undefined;
  active: number;
}

export const workers: WorkerTracker = {
  created: 0,
  jobs: [],
  cancels: [],
  held: false,
  queued: [],
  failing: false,
  live: undefined,
  active: 0,
};

let workerGeneration = 0;

function later(run: () => void) {
  const generation = workerGeneration;
  workers.active += 1;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    if (generation !== workerGeneration) return;
    try {
      run();
    } finally {
      if (generation === workerGeneration) workers.active -= 1;
    }
  };
  channel.port2.postMessage(null);
}

export function flushChannel(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export function release(limit = Infinity) {
  workers.queued.splice(0, limit).forEach(later);
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
    this.recordRequest(message);
    if (message.type === 'job' && workers.failing) {
      this.reply({ id: message.id, failed: true });
      return;
    }
    later(() => {
      if (!this.stopped) this.handler.receive(message);
    });
  }
  private recordRequest(message: Request) {
    if (message.type === 'cancel') {
      workers.cancels.push(message.id);
      this.open.delete(message.id);
      return;
    }
    workers.jobs.push(message);
    this.open.add(message.id);
  }
  private reply(message: Reply) {
    if ('failed' in message || message.done) this.open.delete(message.id);
    const deliver = () => {
      if (!this.stopped)
        this.dispatchEvent(new MessageEvent('message', { data: message }));
    };
    if (workers.held) {
      workers.queued.push(deliver);
      return;
    }
    later(deliver);
  }
  terminate() {
    this.stopped = true;
    this.open.forEach((id) => this.handler.receive({ type: 'cancel', id: id }));
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
  workerGeneration += 1;
  resetHarness();
  renders.reset();
  Object.assign(workers, {
    created: 0,
    jobs: [],
    cancels: [],
    held: false,
    queued: [],
    failing: false,
    active: 0,
  });
  reports.clear();
  intersecting.initially = true;
  useUpdate.setState({ dismissedVersion: null });
  client.clear();
  useTabs.setState({
    tabs: [],
    active: '',
    recent: [],
    messages: {},
    modes: {},
  });
  useActivity.setState({ scopes: {} });
  useErrors.setState({ scopes: {} });
  useSuccesses.setState({ scopes: {} });
  useDecision.setState({ pending: {} });
  useLayout.setState({ tabs: {} });
  useSelection.setState({ repos: {} });
  useFilterStore.setState({ text: {} });
  useDiffView.setState({ mode: null });
  useEditor.setState({ buffers: {} });
  useImageViews.setState({ tabs: {} });
  usePalette.setState({ open: false, settings: false, ignored: null });
  useSettingsNav.setState({ pane: 'general' });
  useGenerate.setState({ repos: {} });
  useCommit.setState({ repos: {} });
  useSystemTheme.setState({ dark: false });
});

afterEach(() => {
  workerGeneration += 1;
  cleanup();
  geometry.rect = flat;
  terminate();
  client.clear();
  vi.useRealTimers();
});
