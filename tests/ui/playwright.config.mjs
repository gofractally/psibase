import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PSIBASE_UI_TEST_PORT || 4179);
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server.mjs',
    url: `http://127.0.0.1:${port}/__health`,
    reuseExistingServer: false,
    timeout: 15_000,
    env: { PSIBASE_UI_TEST_PORT: String(port) },
  },
});
