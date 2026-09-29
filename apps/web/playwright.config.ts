import { defineConfig } from '@playwright/test';

/**
 * Browser tests against the production build (vite preview) with the API mocked by fixtures
 * (SPEC-0002 G5): the same bundle users get, and fast enough to run the specs in parallel.
 * The installed Chrome is used, so no browser download is needed.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
