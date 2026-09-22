import { test, expect } from './fixtures';
for (const theme of ['light', 'dark'] as const) {
  test(`working tree and text diff ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await expect(page.getByText('No repository open')).toBeVisible();
    await page
      .getByRole('button', { name: 'Open repository', exact: true })
      .last()
      .click();
    await expect(
      page.getByLabel('Stage src/app.ts', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('tree', { name: 'Changes', exact: true })
      .getByText('app.ts')
      .click();
    await expect(page.getByText('index → working tree')).toBeVisible();
    await expect(page).toHaveScreenshot(`working-tree-${theme}.png`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`settings shell and generation surfaces ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/?scenario=ai');
    await page
      .getByRole('button', { name: 'Open repository', exact: true })
      .last()
      .click();
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

test('large diffs keep a bounded DOM while scrolling', async ({ page }) => {
  await page.goto('/?scenario=scale');
  await page
    .getByRole('button', { name: 'Open repository', exact: true })
    .last()
    .click();
  await page
    .getByRole('tree', { name: 'Changes', exact: true })
    .getByText('app.ts')
    .click();
  await expect(
    page.getByText('const row0 = 0;', { exact: true }).first(),
  ).toBeVisible();
  const viewer = page.getByLabel('Diff viewer');
  expect(await viewer.locator('code').count()).toBeLessThan(200);
  const after = page.getByLabel('Current version');
  await after.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  await expect(page.getByText('const row0 = 0;', { exact: true })).toHaveCount(
    0,
  );
  expect(await viewer.locator('code').count()).toBeLessThan(200);
  await expect
    .poll(() =>
      page.getByLabel('Previous version').evaluate((e) => e.scrollTop),
    )
    .toBe(await after.evaluate((element) => element.scrollTop));
});

test('split panes fit the width and scroll horizontally alone', async ({
  page,
}) => {
  await page.goto('/?scenario=long');
  await page
    .getByRole('button', { name: 'Open repository', exact: true })
    .last()
    .click();
  await page
    .getByRole('tree', { name: 'Changes', exact: true })
    .getByText('app.ts')
    .click();
  const before = page.getByLabel('Previous version');
  const after = page.getByLabel('Current version');
  const overflows = (element: HTMLElement) =>
    element.scrollWidth > element.clientWidth;
  await expect(page.getByLabel('Diff viewer')).toBeVisible();
  expect(await page.getByLabel('Diff viewer').evaluate(overflows)).toBe(false);
  expect(await before.evaluate(overflows)).toBe(true);
  expect(await after.evaluate(overflows)).toBe(false);
  await before.evaluate((element) => {
    element.scrollLeft = 200;
  });
  expect(await after.evaluate((element) => element.scrollLeft)).toBe(0);
});

test('stacked split columns fit the width of the all-changes pane', async ({
  page,
}) => {
  await page.goto('/?scenario=long');
  await page
    .getByRole('button', { name: 'Open repository', exact: true })
    .last()
    .click();
  await page.getByRole('button', { name: 'All changes', exact: true }).click();
  const pane = page.getByRole('region', { name: 'All changes' });
  const before = pane.getByLabel('Previous version').first();
  const after = pane.getByLabel('Current version').first();
  const overflows = (element: HTMLElement) =>
    element.scrollWidth > element.clientWidth;
  await expect(before).toBeVisible();
  expect(await pane.evaluate(overflows)).toBe(false);
  expect(await before.evaluate(overflows)).toBe(true);
  expect(await after.evaluate(overflows)).toBe(false);
});

for (const mode of ['side by side', 'swipe', 'onion skin']) {
  test(`image comparison ${mode}`, async ({ page }) => {
    await page.route('http://gitblob.localhost/**', async (route) => {
      const old =
        new URL(route.request().url()).searchParams.get('side') === 'old';
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect x="30" y="30" width="260" height="120" rx="20" fill="${old ? '#0f7c86' : '#0072b2'}"/><circle cx="${old ? 120 : 200}" cy="90" r="40" fill="#e69f00"/></svg>`,
      });
    });
    await page.goto('/?scenario=image');
    await page
      .getByRole('button', { name: 'Open repository', exact: true })
      .last()
      .click();
    await page
      .getByRole('tree', { name: 'Changes', exact: true })
      .getByText('picture.png')
      .click();
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await expect(page.getByText(/320×180 → 320×180/)).toBeVisible();
    if (mode === 'swipe') {
      const divider = page.getByRole('slider', { name: 'Swipe divider' });
      await divider.focus();
      await page.keyboard.press('ArrowRight');
      await expect(divider).toHaveAttribute('aria-valuenow', '51');
    }
    if (mode === 'onion skin')
      await page.getByLabel('Onion skin blend').fill('70');
    await expect(page).toHaveScreenshot(
      `image-${mode.replaceAll(' ', '-')}.png`,
    );
  });
}

test('tree icons keep their size in a narrow sidebar', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Open repository', exact: true })
    .last()
    .click();
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
  ).toEqual([12, 12, 12, 12]);
});

test('diff header actions keep one left edge', async ({ page }) => {
  await page.goto('/?scenario=history');
  await page
    .getByRole('button', { name: 'Open repository', exact: true })
    .last()
    .click();
  const group = page
    .getByRole('button', { name: 'Open', exact: true })
    .locator('..');
  const edge = async () => (await group.boundingBox())!.x;
  await page
    .getByRole('tree', { name: 'Changes', exact: true })
    .getByText('app.ts')
    .click();
  await expect(page.getByText('index → working tree')).toBeVisible();
  const worktree = await edge();
  await page.getByRole('button', { name: 'Blame', exact: true }).click();
  expect(await edge()).toBe(worktree);
  await page.getByRole('button', { name: 'Diff', exact: true }).click();
  await page.getByRole('radio', { name: 'history', exact: true }).click();
  await page.getByText('Merge feature', { exact: true }).click();
  await page
    .getByRole('tree', { name: 'Commit files', exact: true })
    .getByRole('treeitem', { name: 'app.ts', exact: true })
    .click();
  await expect(page.getByText(/parent → commit/)).toBeVisible();
  expect(await edge()).toBe(worktree);
});

test('history uses the same diff pane', async ({ page }) => {
  await page.goto('/?scenario=history');
  await page
    .getByRole('button', { name: 'Open repository', exact: true })
    .last()
    .click();
  await page.getByRole('radio', { name: 'history', exact: true }).click();
  await page.getByText('Merge feature', { exact: true }).click();
  await page
    .getByRole('tree', { name: 'Commit files', exact: true })
    .getByRole('treeitem', { name: 'app.ts', exact: true })
    .click();
  await expect(page.getByText(/parent → commit/)).toBeVisible();
  await expect(page.getByTitle('Stage hunk')).toHaveCount(0);
  await expect(page.getByLabel('Commit history').getByRole('img')).toHaveCount(
    3,
  );
  await expect(page).toHaveScreenshot('history.png');
});

for (const theme of ['light', 'dark'] as const) {
  test(`conflicted merge banner ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/?scenario=merge');
    await page
      .getByRole('button', { name: 'Open repository', exact: true })
      .last()
      .click();
    await expect(
      page.getByRole('button', { name: 'Abort merge', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveScreenshot(
      `merge-banner-${theme}.png`,
    );
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`error card and decision card ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Open repository', exact: true })
      .last()
      .click();
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

for (const theme of ['light', 'dark'] as const) {
  test(`stash section ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/?scenario=stash');
    await page
      .getByRole('button', { name: 'Open repository', exact: true })
      .last()
      .click();
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

for (const theme of ['light', 'dark'] as const) {
  test(`rendered markdown ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/?scenario=markdown');
    await page
      .getByRole('button', { name: 'Open repository', exact: true })
      .last()
      .click();
    await page
      .getByRole('tree', { name: 'Changes', exact: true })
      .getByText('README.md')
      .click();
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'GitViewer', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('pnpm install')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Diff viewer', exact: true }),
    ).toHaveScreenshot(`markdown-rendered-${theme}.png`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`branch comparison ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/?scenario=compare');
    await page
      .getByRole('button', { name: 'Open repository', exact: true })
      .last()
      .click();
    await page.getByRole('radio', { name: 'compare', exact: true }).click();
    await expect(page.getByLabel('Base', { exact: true })).toHaveValue('main');
    await expect(page.getByLabel('Compare', { exact: true })).toHaveValue(
      'feature',
    );
    await expect(page.getByText('1 files ·')).toBeVisible();
    await expect(page.getByText(/base → compare/)).toBeVisible();
    await expect(page).toHaveScreenshot(`compare-${theme}.png`);
    await page
      .getByRole('tree', { name: 'Changed files', exact: true })
      .getByRole('treeitem', { name: /app\.ts/ })
      .click();
    await expect(
      page.getByRole('region', { name: 'Diff viewer', exact: true }),
    ).toBeVisible();
    await expect(page.getByTitle('Stage hunk')).toHaveCount(0);
  });
}
