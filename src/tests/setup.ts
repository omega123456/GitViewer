import '@testing-library/jest-dom/vitest';
import './harness';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { client } from '../lib/query';
import { useTabs } from '../stores/tabs';
import { useLayout } from '../stores/layout';
import { useSelection } from '../stores/selection';
import { useFilterStore } from '../stores/filter';
import { useDiffView } from '../stores/diff-view';
import { useImageViews } from '../stores/image-view';
import { usePalette } from '../stores/palette';
import { useSettingsNav } from '../stores/settings-nav';
import { useCommit } from '../stores/commit';
import { useGenerate } from '../stores/generate';
import { useTheme } from '../stores/theme';
import { useDensity } from '../stores/density';
import { useUpdate } from '../stores/update';
import { resetHarness } from './harness';
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
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  value: () => rect,
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
const reports = new Map<Element, Report>();
export const intersecting = { initially: true };
export function intersect(target: Element, visible: boolean) {
  reports.get(target)?.([{ isIntersecting: visible }]);
}
vi.stubGlobal(
  'IntersectionObserver',
  class {
    private targets = new Set<Element>();
    constructor(private callback: Report) {}
    observe(target: Element) {
      this.targets.add(target);
      reports.set(target, this.callback);
      this.callback([{ isIntersecting: intersecting.initially }]);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
      reports.delete(target);
    }
    disconnect() {
      this.targets.forEach((target) => reports.delete(target));
      this.targets.clear();
    }
  },
);
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));
beforeEach(() => {
  resetHarness();
  reports.clear();
  intersecting.initially = true;
  useUpdate.setState({ dismissedVersion: null });
  client.clear();
  useTabs.setState({ tabs: [], active: '', error: null, busy: 0 });
  useLayout.setState({ tabs: {} });
  useSelection.setState({
    working: {},
    history: {},
    compare: {},
    all: {},
    paths: {},
  });
  useFilterStore.setState({ text: {} });
  useDiffView.setState({ mode: null });
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
  client.clear();
});
