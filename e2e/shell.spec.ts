import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  THEMES,
  diffViewer,
  mockImageBlobs,
  openRepository,
  openScenario,
  selectChange,
} from './helpers';

const HISTORY_GRAPH_ROWS = 3;
const IMAGE_MODES = ['side by side', 'swipe', 'onion skin'] as const;

const prepareImageMode: Record<
  (typeof IMAGE_MODES)[number],
  (page: Page) => Promise<void>
> = {
  'side by side': async () => {},
  swipe: async (page) => {
    const divider = page.getByRole('slider', { name: 'Swipe divider' });
    await divider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(divider).toHaveAttribute('aria-valuenow', '51');
  },
  'onion skin': async (page) => {
    await page.getByLabel('Onion skin blend').fill('70');
  },
};

for (const theme of THEMES) {
  test(`working tree and text diff ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await expect(page.getByText('No repository open')).toBeVisible();
    await openRepository(page);
    await expect(
      page.getByLabel('Stage src/app.ts', { exact: true }),
    ).toBeVisible();
    await selectChange(page, 'app.ts');
    await expect(page.getByText('index → working tree')).toBeVisible();
    await expect(
      page.locator('code span[style*="--syntax-color: #"]').first(),
    ).toBeVisible();
    await expect(page).toHaveScreenshot(`working-tree-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`settings shell and generation surfaces ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=ai', theme);
    await expect(
      page.getByRole('button', { name: 'Generate', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Commit', exact: true }),
    ).toHaveScreenshot(`commit-generate-${theme}.png`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Settings', exact: true }),
    ).toHaveScreenshot(`settings-shell-${theme}.png`);
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'AI', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Settings', exact: true }),
    ).toHaveScreenshot(`settings-ai-${theme}.png`);
    await page.getByRole('combobox', { name: 'Model', exact: true }).click();
    await expect(page.getByRole('listbox')).toHaveScreenshot(
      `model-menu-${theme}.png`,
    );
  });
}

for (const mode of IMAGE_MODES) {
  for (const theme of THEMES) {
    test(`image comparison ${mode} ${theme}`, async ({ page }) => {
      await mockImageBlobs(page);
      await openScenario(page, '/?scenario=image', theme);
      await selectChange(page, 'picture.png');
      await page.getByRole('tab', { name: mode, exact: true }).click();
      await expect(page.getByText(/320×180 → 320×180/)).toBeVisible();
      await prepareImageMode[mode](page);
      await expect(diffViewer(page)).toHaveScreenshot(
        `image-${mode.replaceAll(' ', '-')}-${theme}.png`,
      );
    });
  }
}

for (const theme of THEMES) {
  test(`history uses the same diff pane ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=history', theme);
    await page.getByRole('tab', { name: 'history', exact: true }).click();
    await page.getByText('Merge feature', { exact: true }).click();
    await page
      .getByRole('tree', { name: 'Commit files', exact: true })
      .getByRole('treeitem', { name: 'app.ts', exact: true })
      .click();
    await expect(page.getByText(/parent → commit/)).toBeVisible();
    await expect(page.getByTitle('Stage hunk')).toHaveCount(0);
    await expect(
      page.getByLabel('Commit history').getByRole('img'),
    ).toHaveCount(HISTORY_GRAPH_ROWS);
    await expect(page.getByRole('complementary')).toHaveScreenshot(
      `history-${theme}.png`,
    );
  });
}

for (const theme of THEMES) {
  test(`conflicted merge banner ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=merge', theme);
    await expect(
      page.getByRole('button', { name: 'Abort merge', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveScreenshot(
      `merge-banner-${theme}.png`,
    );
  });
}

for (const theme of THEMES) {
  test(`success, info, error and decision cards ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=stash', theme);
    await page.getByRole('button', { name: /Stashes/ }).click();
    await page.getByText('WIP on main: parser rewrite').click();
    await page.getByLabel('Drop stash@{0}', { exact: true }).click();
    const success = page.locator('li', { hasText: 'Stash dropped' });
    await expect(success.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(success).toHaveScreenshot(`success-card-${theme}.png`);
    await success.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(success).toBeHidden();
    await page.getByRole('button', { name: /^fetch/i }).click();
    const info = page.locator('li', { hasText: 'Fetched' });
    await expect(info.getByText('Up to date')).toBeVisible();
    await expect(info).toHaveScreenshot(`info-card-${theme}.png`);
    await info.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(info).toBeHidden();
    await page.getByRole('button', { name: /^push/ }).click();
    const card = page.locator('li', { hasText: 'Push rejected' });
    await expect(card.getByRole('button', { name: 'Pull' })).toBeVisible();
    await card.getByRole('button', { name: 'Show details' }).click();
    await expect(
      card.getByText('! [rejected]', { exact: false }),
    ).toBeVisible();
    await expect(card).toHaveScreenshot(`error-card-${theme}.png`);
    await page.getByRole('button', { name: 'main', exact: true }).click();
    await page.getByRole('button', { name: /^feature/ }).click();
    const decision = page.getByRole('dialog', { name: 'Switch to feature?' });
    await expect(
      decision.getByRole('button', { name: 'Stash and switch' }),
    ).toBeFocused();
    await expect(decision).toHaveScreenshot(`decision-card-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`stash section ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=stash', theme);
    await page.getByRole('button', { name: /Stashes/ }).click();
    await page.getByText('WIP on main: parser rewrite').click();
    await expect(
      page.getByRole('tree', { name: 'Stash files', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel('Drop stash@{0}', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Stashes', exact: true }),
    ).toHaveScreenshot(`stash-section-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`diff context gaps ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=context', theme);
    await selectChange(page, 'app.ts');
    await expect(page.getByText('26 hidden lines above')).toBeVisible();
    await expect(
      page.getByLabel('Show 20 more lines above hunk 1'),
    ).toBeVisible();
    await expect(
      page.getByText('13 hidden lines', { exact: true }),
    ).toBeVisible();
    await expect(diffViewer(page)).toHaveScreenshot(
      `diff-context-gaps-${theme}.png`,
    );
  });
}

for (const theme of THEMES) {
  test(`find bar ${theme}`, async ({ page }) => {
    await openScenario(page, '/', theme);
    await selectChange(page, 'app.ts');
    await expect(page.getByText('index → working tree')).toBeVisible();
    await expect(
      page.locator('code span[style*="--syntax-color: #"]').first(),
    ).toBeVisible();
    await page.keyboard.press('Meta+f');
    await page.getByRole('textbox', { name: 'Find in file' }).fill('value');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('search').getByRole('status')).toHaveText(
      /^2 of \d+$/,
    );
    await expect(diffViewer(page)).toHaveScreenshot(`find-bar-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`rendered markdown ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=markdown', theme);
    await selectChange(page, 'README.md');
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'GitViewer', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('pnpm install')).toBeVisible();
    await expect(diffViewer(page)).toHaveScreenshot(
      `markdown-rendered-${theme}.png`,
    );
  });
}

for (const theme of THEMES) {
  test(`branch comparison ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=compare', theme);
    await page.getByRole('tab', { name: 'compare', exact: true }).click();
    await expect(page.getByLabel('Base', { exact: true })).toHaveValue('main');
    await expect(page.getByLabel('Compare', { exact: true })).toHaveValue(
      'feature',
    );
    await expect(page.getByText('1 files ·')).toBeVisible();
    await expect(page.getByText(/base → compare/)).toBeVisible();
    const workspace = page.getByRole('complementary').locator('..');
    await expect(workspace).toHaveScreenshot(`compare-${theme}.png`);
    await page
      .getByRole('tree', { name: 'Changed files', exact: true })
      .getByRole('treeitem', { name: /app\.ts/ })
      .click();
    await expect(diffViewer(page)).toBeVisible();
    await expect(page.getByTitle('Stage hunk')).toHaveCount(0);
  });
}

for (const theme of THEMES) {
  test(`new branch dialog ${theme}`, async ({ page }) => {
    await openScenario(page, '/', theme);
    await expect(
      page.getByLabel('Stage src/app.ts', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+B');
    const name = page.getByLabel('Name', { exact: true });
    await expect(name).toBeFocused();
    await name.pressSequentially('fix login');
    await expect(name).toHaveValue('fix-login');
    await expect(
      page.getByRole('combobox', { name: 'Based on', exact: true }),
    ).toHaveText('maincurrent');
    await expect(
      page.getByRole('dialog', { name: 'New branch', exact: true }),
    ).toHaveScreenshot(`new-branch-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`command palette ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=repositories', theme);
    await page.mouse.move(0, 0);
    await expect(
      page.getByLabel('Stage src/app.ts', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('F2');
    const palette = page.getByRole('dialog', {
      name: 'Command palette',
      exact: true,
    });
    await page.getByLabel('Find file', { exact: true }).fill('s');
    await expect(
      palette.getByRole('button', { name: /CommandPalette\.tsx/ }),
    ).toBeVisible();
    await expect(palette).toHaveScreenshot(`command-palette-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`working-tree editor ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=editor', theme);
    await selectChange(page, 'new.txt');
    await selectChange(page, 'app.ts');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('TypeScript', { exact: true })).toBeVisible();
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('export { aliases };');
    await expect(page.getByLabel('Unsaved changes')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+r');
    const bar = page.getByRole('search');
    await bar.getByRole('textbox', { name: 'Find in file' }).fill('aliases');
    await bar.getByRole('textbox', { name: 'Replace with' }).fill("'names'");
    await expect(bar.getByRole('status')).toHaveText(/^1 of \d+$/);
    await expect(diffViewer(page)).toHaveScreenshot(`editor-${theme}.png`);
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    const tabs = page.getByRole('tablist', { name: 'Open files' });
    await tabs.getByRole('tab', { name: 'new.txt' }).click();
    await expect(tabs.getByLabel('Unsaved edits')).toBeVisible();
    await expect(tabs).toHaveScreenshot(`file-tabs-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`branch popover with worktrees ${theme}`, async ({ page }) => {
    await openScenario(page, '/?scenario=worktrees', theme);
    const trigger = page.getByRole('button', { name: /^fixture \/ main/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByText('gv-legacy')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveScreenshot(
      `branch-popover-${theme}.png`,
    );
    await page.getByRole('button', { name: 'Actions for gv-hotfix' }).click();
    await page
      .getByRole('menuitem', { name: 'Apply to main checkout' })
      .click();
    const warning = page.locator('li', { hasText: 'Applied to main with' });
    await expect(
      warning.getByRole('button', { name: 'Show main' }),
    ).toBeVisible();
    await expect(warning).toHaveScreenshot(`warning-card-${theme}.png`);
    await trigger.click();
    await page.getByRole('button', { name: 'New worktree' }).click();
    const form = page.getByRole('dialog', {
      name: 'New worktree',
      exact: true,
    });
    await expect(form.getByLabel('Folder', { exact: true })).toHaveValue(
      '/Users/me/Projects/fixture-3f9c2a1',
    );
    await expect(form).toHaveScreenshot(`new-worktree-${theme}.png`);
  });
}
