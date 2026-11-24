import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  boundingBoxOf,
  elementOverflowsWidth,
  openScenario,
  requiredElementHandle,
  selectChange,
} from './helpers';

const MAX_RENDERED_CODE_LINES = 200;
const HALF_DIVISOR = 2;
const PAGE_DOWN_PRESSES = 60;
const PAGE_UP_PRESSES = 30;
const HORIZONTAL_SCROLL_OFFSET = 200;
const CHEVRON_ICON_WIDTH = 12;
const FILE_ICON_WIDTH = 15;
const EXPECTED_ICON_WIDTHS = [
  CHEVRON_ICON_WIDTH,
  FILE_ICON_WIDTH,
  FILE_ICON_WIDTH,
  FILE_ICON_WIDTH,
];

interface ScrollStep {
  page: Page;
  scroller: Locator;
  key: 'PageDown' | 'PageUp';
}

const KEY_PRESS_COUNTS: Record<ScrollStep['key'], number> = {
  PageDown: PAGE_DOWN_PRESSES,
  PageUp: PAGE_UP_PRESSES,
};

async function holdScrollKey({ page, scroller, key }: ScrollStep) {
  const pressCount = KEY_PRESS_COUNTS[key];
  for (let index = 0; index < pressCount; index++) {
    const before = await scroller.evaluate((element) => element.scrollTop);
    await page.keyboard.down(key);
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .not.toBe(before);
    await expect(scroller).toBeFocused();
  }
  await page.keyboard.up(key);
}

test('large diffs keep a bounded DOM while scrolling', async ({ page }) => {
  await openScenario(page, '/?scenario=scale');
  await selectChange(page, 'app.ts');
  await expect(
    page.getByText('const row0 = 0;', { exact: true }).first(),
  ).toBeVisible();
  const viewer = page.getByLabel('Diff viewer');
  expect(await viewer.locator('code').count()).toBeLessThan(
    MAX_RENDERED_CODE_LINES,
  );
  await expect
    .poll(() =>
      viewer.locator('.text-syntax').evaluateAll((spans) =>
        spans.some((span) => {
          if (!(span instanceof HTMLElement)) return false;
          const color = span.style.getPropertyValue('--syntax-color');
          return color !== '' && color !== 'inherit';
        }),
      ),
    )
    .toBe(true);
  const after = page.getByLabel('Current version');
  await after.evaluate((element, divisor) => {
    element.scrollTop = element.scrollHeight / divisor;
  }, HALF_DIVISOR);
  await expect(page.getByText('const row0 = 0;', { exact: true })).toHaveCount(
    0,
  );
  expect(await viewer.locator('code').count()).toBeLessThan(
    MAX_RENDERED_CODE_LINES,
  );
  await expect
    .poll(() =>
      page
        .getByLabel('Previous version')
        .evaluate((element) => element.scrollTop),
    )
    .toBe(await after.evaluate((element) => element.scrollTop));
});

for (const mode of ['unified', 'split'] as const) {
  for (const stacked of [false, true]) {
    test(`${mode} diff keeps keyboard scrolling ${stacked ? 'stacked' : 'single file'}`, async ({
      page,
    }) => {
      await openScenario(
        page,
        `/?scenario=${stacked ? 'stack-scroll' : 'scale'}`,
      );
      await selectChange(page, 'app.ts');
      await page.getByRole('tab', { name: mode, exact: true }).click();
      if (stacked)
        await page
          .getByRole('button', { name: 'All changes', exact: true })
          .click();
      const pane = page.getByRole('region', {
        name: stacked ? 'All changes' : 'Diff viewer',
        exact: true,
      });
      const first = pane.getByText('const row0 = 0;', { exact: true }).first();
      await first.click();
      const clicked = await requiredElementHandle(first);
      const scroller = pane.locator(
        stacked ? '.overflow-y-auto' : '.overflow-auto',
      );
      await expect(scroller).toBeFocused();
      for (const key of ['PageDown', 'PageUp'] as const) {
        await holdScrollKey({ page: page, scroller: scroller, key: key });
        await expect
          .poll(() => clicked.evaluate((element) => element.isConnected))
          .toBe(false);
      }
    });
  }
}

test('split panes fit the width and scroll horizontally alone', async ({
  page,
}) => {
  await openScenario(page, '/?scenario=long');
  await selectChange(page, 'app.ts');
  const before = page.getByLabel('Previous version');
  const after = page.getByLabel('Current version');
  await expect(page.getByLabel('Diff viewer')).toBeVisible();
  expect(
    await page.getByLabel('Diff viewer').evaluate(elementOverflowsWidth),
  ).toBe(false);
  expect(await before.evaluate(elementOverflowsWidth)).toBe(true);
  expect(await after.evaluate(elementOverflowsWidth)).toBe(false);
  await before.evaluate((element, offset) => {
    element.scrollLeft = offset;
  }, HORIZONTAL_SCROLL_OFFSET);
  expect(await after.evaluate((element) => element.scrollLeft)).toBe(0);
});

test('stacked split columns fit the width of the all-changes pane', async ({
  page,
}) => {
  await openScenario(page, '/?scenario=long');
  await page.getByRole('button', { name: 'All changes', exact: true }).click();
  const pane = page.getByRole('region', { name: 'All changes' });
  const before = pane.getByLabel('Previous version').first();
  const after = pane.getByLabel('Current version').first();
  await expect(before).toBeVisible();
  expect(await pane.evaluate(elementOverflowsWidth)).toBe(false);
  expect(await before.evaluate(elementOverflowsWidth)).toBe(true);
  expect(await after.evaluate(elementOverflowsWidth)).toBe(false);
});

test('tree icons keep their size in a narrow sidebar', async ({ page }) => {
  await openScenario(page, '/');
  const tree = page.getByRole('tree', { name: 'Changes', exact: true });
  await tree.getByText('app.ts').waitFor();
  await page.addStyleTag({
    content: '[aria-label="Changes"] { width: 120px !important; }',
  });
  expect(
    await tree.evaluate((root) =>
      [...root.querySelectorAll('[role="treeitem"] svg')].map((icon) =>
        Math.round(icon.getBoundingClientRect().width),
      ),
    ),
  ).toEqual(EXPECTED_ICON_WIDTHS);
});

test('diff header actions keep one left edge', async ({ page }) => {
  await openScenario(page, '/?scenario=history');
  const group = page
    .getByRole('button', { name: 'Open', exact: true })
    .locator('..');
  const edge = async () => (await boundingBoxOf(group)).x;
  await selectChange(page, 'app.ts');
  await expect(page.getByText('index → working tree')).toBeVisible();
  const worktree = await edge();
  await page.getByRole('button', { name: 'Blame', exact: true }).click();
  expect(await edge()).toBe(worktree);
  await page.getByRole('button', { name: 'Diff', exact: true }).click();
  await page.getByRole('tab', { name: 'history', exact: true }).click();
  await page.getByText('Merge feature', { exact: true }).click();
  await page
    .getByRole('tree', { name: 'Commit files', exact: true })
    .getByRole('treeitem', { name: 'app.ts', exact: true })
    .click();
  await expect(page.getByText(/parent → commit/)).toBeVisible();
  expect(await edge()).toBe(worktree);
});
