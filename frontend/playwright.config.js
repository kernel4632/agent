import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: process.env.LA_TEST_OUTPUT_DIR || './test-results/ui-audit',
  timeout: 90_000,
  expect: { timeout: 6_000 },
  workers: 1,
  reporter: [['line'], ['html', { open: 'never', outputFolder: process.env.LA_TEST_OUTPUT_DIR ? `${process.env.LA_TEST_OUTPUT_DIR}-report` : 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    colorScheme: 'dark',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    reducedMotion: 'reduce',
    screenshot: { mode: 'only-on-failure', fullPage: true },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
