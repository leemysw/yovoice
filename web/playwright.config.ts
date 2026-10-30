import { defineConfig } from '@playwright/test';

// 已封存：功能稳定、很少再改的用例，日常提交不跑；每周定时、发布前或设置 PW_ALL=1 时全量运行。
// 改到这些功能时用 `pnpm run test:all`（或 PW_ALL=1 加文件名定向跑）验证，常改的功能移出列表。
const sealed = [
  'book', 'caption-export', 'guide', 'library', 'logs', 'performances',
  'subtitles', 'timeline', 'timeline-logic', 'update', 'assets',
].map(name => `**/${name}.spec.ts`);

export default defineConfig({
  testDir: './browser-tests', testMatch: '*.spec.ts', testIgnore: process.env.PW_ALL ? [] : sealed, fullyParallel: true,
  // 不使用本机声卡：用例依赖音频时钟前进，真实输出设备被占用或休眠时会停住；CI 本就没有声卡，这样两边行为一致。
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 920 }, reducedMotion: 'reduce', launchOptions: { args: ['--disable-audio-output'] } },
  webServer: { command: 'pnpm run dev --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
