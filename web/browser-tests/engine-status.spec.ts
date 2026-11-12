import { expect, test } from '@playwright/test';
import { emptyState, type Activity } from '../src/shared/workbench';
import catalog from '../../internal/catalog/catalog.json' with { type: 'json' };

declare global {
  interface Window {
    __enginePhase: string;
    __changeGeneration: (activity: Activity) => void;
    __runtimeCalls: string[];
  }
}

test('生成区区分加载、合成、流式进度、保存与空闲卸载', async ({ page }) => {
  const state = emptyState();
  state.preferences = { ...state.preferences, introSeen: true, tourSeen: true };
  state.runtimePath = '/runtime/audiocpp_server';
  state.runtimeBackend = 'cpu';
  state.runtimeVersion = 'v0.9.3';
  const draft = state.drafts[0];
  draft.modelId = 'index-2-q8';
  state.models = [{ id: draft.modelId, path: '/models/index.gguf', managed: false }];
  const activity: Activity = {
    kind: 'generate', status: 'running', code: '@yovoice.activity.engineStart', params: null,
    projectId: draft.id, received: 0, total: 1, errorCode: null, errorParams: null, startedAt: new Date().toISOString(),
  };
  state.activity = activity;
  await page.addInitScript(({ state, catalog }) => {
    let receive: (event: { data: unknown }) => void;
    window.__enginePhase = 'starting';
    window.__runtimeCalls = [];
    window.__changeGeneration = next => {
      state.activity = next;
      receive({ data: { event: 'state', state } });
    };
    Object.defineProperty(window, 'chrome', { value: { webview: {
      addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
      postMessage: ({ id, method }: { id: string; method: string }) => {
        window.__runtimeCalls.push(method);
        let result: unknown = true;
        if (method === 'state.get') result = { state, catalog: catalog.models, engine: { version: 'v0.9.3', minimum: 'v0.7.4' }, assistant: { available: false } };
        if (method === 'runtime.status') result = { phase: window.__enginePhase, modelId: 'index-2-q8', modelName: 'IndexTTS 2.0', idleUnloadSeconds: 300 };
        queueMicrotask(() => receive({ data: { id, result } }));
      },
    } } });
  }, { state, catalog });
  await page.goto('/');
  const status = page.getByTestId('engine-status');
  await expect(status).toContainText('正在启动 audio.cpp');
  await page.evaluate(next => {
    window.__enginePhase = 'unloaded';
    window.__changeGeneration(next);
  }, { ...activity, code: '@yovoice.activity.synthesizing' } satisfies Activity);
  await expect(status).toContainText('正在加载模型');
  await expect(status.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await page.evaluate(() => { window.__enginePhase = 'ready'; });
  await expect(status).toContainText('模型已加载');
  await expect(status).toContainText('正在合成语音');
  await page.evaluate(next => window.__changeGeneration(next), {
    ...activity, code: '@yovoice.activity.streamingAudio', params: { chunks: 2, seconds: '1.5' },
  } satisfies Activity);
  await expect(status).toContainText('已生成 1.5 秒音频（2 个片段）');
  await page.evaluate(next => window.__changeGeneration(next), { ...activity, code: '@yovoice.activity.savingAudio' } satisfies Activity);
  await expect(status).toContainText('正在保存音频');
  await page.evaluate(next => window.__changeGeneration(next), { ...activity, status: 'completed', code: '@yovoice.activity.completed' } satisfies Activity);
  await expect(status.getByRole('progressbar')).toHaveCount(0);
  await page.evaluate(() => { window.__enginePhase = 'unloaded'; });
  await expect(status).toContainText('模型已卸载', { timeout: 8000 });
  await expect.poll(() => page.evaluate(() => window.__runtimeCalls.includes('runtime.unload'))).toBe(false);
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '推理引擎', exact: true }).click();
  await expect(page.locator('#engine-panel').getByTestId('engine-status')).toContainText('空闲 300 秒后自动卸载');
});
