import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // all tests share one dev-user/cellar in the e2e D1 — avoid cross-test races
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 420, height: 900 },
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Every run starts from an empty database of its own (e2e/reset-db.mjs) on
  // its own port, so it never reuses a server or the data of `wrangler dev`.
  webServer: {
    command:
      'node e2e/reset-db.mjs && npx wrangler dev --persist-to worker/.wrangler/e2e-state --var CALICE_DEV_EMAIL:e2e@test.com --port 8788',
    url: 'http://127.0.0.1:8788/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
