import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/ui-audit',
  timeout: 90_000,
  expect: { timeout: 6_000 },
  workers: 1,
  reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    colorScheme: 'dark',
    screenshot: { mode: 'only-on-failure', fullPage: true },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'bun run dev -- --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
