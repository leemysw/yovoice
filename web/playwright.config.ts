import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './browser-tests', testMatch: '*.spec.ts', use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 920 } }, webServer: { command: 'pnpm run dev --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI } });
