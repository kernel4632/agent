/* 真实前后端联调：独立端口与数据目录，不复用开发服务或浏览器接口 mock。
 * 运行：bun run test:live
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests', testMatch: 'ui-live.spec.js',
  outputDir: '../tmp/ui-live', workers: 1,
  timeout: 60_000, expect: { timeout: 10_000 },
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:4175', channel: process.env.PLAYWRIGHT_CHANNEL, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    { command: 'bun tests/live-backend.js', url: 'http://127.0.0.1:3001/health', env: { PORT: '3001' }, reuseExistingServer: false },
    { command: 'bun run dev --port 4175 --strictPort', url: 'http://127.0.0.1:4175', env: { AGENT_SERVER_URL: 'http://127.0.0.1:3001' }, reuseExistingServer: false },
  ],
})
