import { test, expect } from '@playwright/test';

test.use({ launchOptions: { args: ['--disable-audio-output', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

declare global {
  interface Window {
    mic: {
      tracks: MediaStreamTrack[];
      pending: (() => void)[];
      hold: boolean;
      deny: boolean;
      calls: number;
      blobs: Blob[];
      errors: string[];
      recorder: ReturnType<typeof import('../src/features/media/recorder').useRecorder>;
      start: (options?: MediaRecorderOptions) => Promise<void>;
      unmount: () => void;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.mic = { tracks: [], pending: [], hold: false, deny: false, calls: 0, blobs: [], errors: [] } as unknown as Window['mic'];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.mic.calls++;
      if (window.mic.deny) throw new DOMException('denied', 'NotAllowedError');
      const stream = await original(constraints);
      window.mic.tracks.push(...stream.getTracks());
      if (window.mic.hold) await new Promise<void>(resolve => window.mic.pending.push(resolve));
      return stream;
    };
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js';
    const domPath = '/node_modules/.vite/deps/react-dom_client.js';
    const hookPath = '/src/features/media/recorder.tsx';
    const { createElement, useEffect } = (await import(reactPath)).default;
    const { createRoot } = (await import(domPath)).default;
    const { useRecorder } = await import(hookPath);
    const root = createRoot(document.createElement('section'));
    function Harness() {
      const recorder = useRecorder(60);
      useEffect(() => {
        window.mic.recorder = recorder;
        window.mic.start = async options => {
          try { await recorder.start((blob: Blob) => window.mic.blobs.push(blob), options); }
          catch (error) { window.mic.errors.push((error as Error).name); }
        };
      });
      return null;
    }
    window.mic.unmount = () => root.unmount();
    root.render(createElement(Harness));
  });
  await expect.poll(() => page.evaluate(() => !!window.mic.start)).toBe(true);
});

test('快速启动两次后停止，不遗留活动麦克风', async ({ page }) => {
  await page.evaluate(async () => { await Promise.all([window.mic.start(), window.mic.start()]); });
  await page.evaluate(() => window.mic.recorder.stop());
  await expect.poll(() => page.evaluate(() => window.mic.tracks.map(t => t.readyState))).toEqual(['ended']);
  expect(await page.evaluate(() => window.mic.calls)).toBe(1);
});

for (const action of ['cancel', 'stop', 'unmount'] as const) {
  test(`等待授权时 ${action}，迟到的流立即释放`, async ({ page }) => {
    await page.evaluate(() => { window.mic.hold = true; void window.mic.start(); });
    await expect.poll(() => page.evaluate(() => window.mic.pending.length)).toBe(1);
    await page.evaluate(action => {
      if (action === 'unmount') window.mic.unmount();
      else window.mic.recorder[action]();
      window.mic.pending.splice(0).forEach(resolve => resolve());
    }, action);
    await expect.poll(() => page.evaluate(() => window.mic.tracks.map(t => t.readyState))).toEqual(['ended']);
    expect(await page.evaluate(() => window.mic.blobs.length)).toBe(0);
  });
}

test('单次录音停止后产生音频并释放全部轨道', async ({ page }) => {
  await page.evaluate(() => window.mic.start());
  await expect.poll(() => page.evaluate(() => window.mic.recorder.recording)).toBe(true);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.mic.recorder.stop());
  await expect.poll(() => page.evaluate(() => window.mic.blobs[0]?.size ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.mic.tracks.map(t => t.readyState))).toEqual(['ended']);
});

for (const action of ['cancel', 'unmount'] as const) {
  test(`录音期间 ${action} 释放轨道且不交付音频`, async ({ page }) => {
    await page.evaluate(() => window.mic.start());
    await page.evaluate(action => {
      if (action === 'unmount') window.mic.unmount();
      else window.mic.recorder.cancel();
    }, action);
    expect(await page.evaluate(() => window.mic.tracks.map(t => t.readyState))).toEqual(['ended']);
    expect(await page.evaluate(() => window.mic.blobs.length)).toBe(0);
  });
}

test('取消后重新开始，旧授权结果不影响新录音', async ({ page }) => {
  await page.evaluate(() => { window.mic.hold = true; void window.mic.start(); });
  await expect.poll(() => page.evaluate(() => window.mic.pending.length)).toBe(1);
  await page.evaluate(async () => {
    window.mic.recorder.cancel();
    window.mic.hold = false;
    await window.mic.start();
    window.mic.pending.splice(0).forEach(resolve => resolve());
  });
  await expect.poll(() => page.evaluate(() => window.mic.tracks.map(t => t.readyState))).toEqual(['ended', 'live']);
  await page.evaluate(() => window.mic.recorder.cancel());
  expect(await page.evaluate(() => window.mic.tracks.map(t => t.readyState))).toEqual(['ended', 'ended']);
});

test('授权拒绝或录音器初始化失败后仍可重试', async ({ page }) => {
  await page.evaluate(async () => {
    window.mic.deny = true;
    await window.mic.start();
    window.mic.deny = false;
    await window.mic.start({ mimeType: 'invalid/type' });
  });
  expect(await page.evaluate(() => window.mic.errors)).toEqual(['NotAllowedError', 'NotSupportedError']);
  expect(await page.evaluate(() => window.mic.tracks.map(t => t.readyState))).toEqual(['ended']);
  await page.evaluate(() => window.mic.start());
  await page.evaluate(() => window.mic.recorder.cancel());
  await expect.poll(() => page.evaluate(() => window.mic.tracks.map(t => t.readyState))).toEqual(['ended', 'ended']);
  expect(await page.evaluate(() => window.mic.blobs.length)).toBe(0);
});
