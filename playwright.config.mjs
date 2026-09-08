import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1280, height: 820 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev:web',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
  },
  expect: { toHaveScreenshot: { animations: 'disabled' } },
});
