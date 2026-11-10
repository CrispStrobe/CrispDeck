import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  fullyParallel: true,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  outputDir: 'playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit-desktop',
      testMatch: ['mastodon-people-search.test.ts'],
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'webkit-mobile',
      testMatch: ['mobile-layout.test.ts', 'safe-area.test.ts'],
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: process.env.PLAYWRIGHT_DEV_SERVER
      ? 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort'
      : 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
