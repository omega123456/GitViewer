import { test as base, expect } from '@playwright/test';
import { FROZEN_TIME } from './scenario-data';
import { buildMockBundle, type MockBundle } from './scenarios';

type CommandArgs = Record<string, string>;

interface InvokePayload {
  command: string;
  args: CommandArgs;
}

const mockBundle = buildMockBundle();

function installPluginInternals() {
  Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
    value: { unregisterListener: () => {} },
  });
  Object.defineProperty(window, '__TAURI_OS_PLUGIN_INTERNALS__', {
    value: { platform: 'macos' },
  });
}

function installTauriInternals(bundle: MockBundle) {
  const scenarioName =
    new URLSearchParams(window.location.search).get('scenario') ?? 'default';
  const active = bundle.scenarios[scenarioName] ?? bundle.scenarios.default;
  const staticCommands = { ...bundle.staticCommands, ...active.staticCommands };
  if (active.generatedLineCount > 0) {
    active.diff.hunks[0].lines = Array.from(
      Array(active.generatedLineCount).keys(),
      (index) => ({
        ...bundle.contextLineTemplate,
        content: `const row${index} = ${index};`,
        old: index + 1,
        new: index + 1,
      }),
    );
  }
  let callbackId = 0;
  const dynamicCommands: Record<string, (args: CommandArgs) => unknown> = {
    repo_open: (args) => active.reposByPath[args.path] ?? active.fallbackRepo,
    status: (args) => active.statusByRepo[args.repo] ?? active.fallbackStatus,
    tree: (args) => (args.path ? bundle.treeChildren : bundle.treeRoot),
    diff: () => active.diff,
    diff_stack: () => ({
      files: Object.fromEntries(
        active.stackPaths.map((path) => [path, active.diff]),
      ),
      truncated: false,
    }),
    sync: (args) => {
      if (args.action === 'fetch') return 0;
      throw bundle.errors.pushRejected;
    },
    branch_switch: () => {
      throw bundle.errors.branchSwitchBlocked;
    },
  };
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {
      metadata: bundle.metadata,
      transformCallback: () => ++callbackId,
      unregisterCallback: () => {},
      convertFileSrc: (path: string, protocol: string) =>
        `http://${protocol}.localhost/${path}`,
      invoke: async (name: string, payload: InvokePayload) => {
        if (name === 'plugin:event|listen') return ++callbackId;
        if (name in bundle.staticPlugins) return bundle.staticPlugins[name];
        if (name !== 'execute')
          throw new Error(`Unmocked e2e invocation: ${name}`);
        if (payload.command in dynamicCommands)
          return dynamicCommands[payload.command](payload.args);
        if (payload.command in staticCommands)
          return staticCommands[payload.command];
        throw new Error(`Unmocked e2e command: ${payload.command}`);
      },
    },
  });
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(installPluginInternals);
    await page.addInitScript(installTauriInternals, mockBundle);
    await page.clock.setFixedTime(FROZEN_TIME);
    await use(page);
  },
});

export { expect };
