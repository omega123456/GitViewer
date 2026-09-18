import { test, expect } from './fixtures';
for (const theme of ['light', 'dark'] as const) {
  test(`update components ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/?scenario=update');
    await expect(
      page.getByRole('complementary', { name: 'Application update' }),
    ).toHaveScreenshot(`update-banner-${theme}.png`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Updates', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Updates', exact: true }),
    ).toHaveScreenshot(`updates-settings-${theme}.png`);
  });
}
