import { test, expect } from '@playwright/test';
import { emptyState } from '../src/shared/workbench';
import catalog from '../../internal/catalog/catalog.json' with { type: 'json' };

declare global {
  interface Window {
    __localImportResult: 'cancel' | 'success' | 'error';
    __localModelCalls: { method: string; data: { id?: string } }[];
  }
}

test('本地模型按所选精度请求原生文件框，取消不改变状态，成功后显示外部路径', async ({ page }) => {
  const state = emptyState();
  state.preferences = { ...state.preferences, introSeen: true, tourSeen: true };
  await page.addInitScript(({ state, catalog }) => {
    let receive: (event: { data: unknown }) => void;
    window.__localImportResult = 'cancel';
    window.__localModelCalls = [];
    Object.defineProperty(window, 'chrome', { value: { webview: {
      addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
      postMessage: (message: { id: string; method: string; data: { id?: string } }) => {
        window.__localModelCalls.push(message);
        queueMicrotask(() => {
          let result: unknown = true;
          if (message.method === 'state.get') result = { state, catalog: catalog.models, engine: { version: 'v0.9.3', minimum: 'v0.7.4' }, assistant: { available: false } };
          if (message.method === 'model.import') {
            if (window.__localImportResult === 'error') {
              receive({ data: { id: message.id, error: { code: '@yovoice.error.localModelInvalid' } } }); return;
            }
            if (window.__localImportResult === 'cancel') result = null;
            else {
              state.models = [{ id: message.data.id!, path: '/external/models/kokoro.gguf', managed: false, sha256: '' }];
              receive({ data: { event: 'state', state } });
            }
          }
          receive({ data: { id: message.id, result } });
        });
      },
    } } });
  }, { state, catalog });
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  const row = page.locator('[data-model-ids~="kokoro-82m-q8"]');
  await expect(page.getByText(/PyTorch／MLX 原始权重须先转换/)).toBeVisible();
  await row.getByRole('radio', { name: 'BF16', exact: true }).click();
  await row.getByRole('button', { name: '导入本地模型' }).click();
  await expect.poll(() => page.evaluate(() => window.__localModelCalls.filter(call => call.method === 'model.import').map(call => call.data.id))).toEqual(['kokoro-82m-bf16']);
  await expect(row).toHaveAttribute('data-installed', 'false');
  await page.evaluate(() => { window.__localImportResult = 'error'; });
  await row.getByRole('button', { name: '导入本地模型' }).click();
  await expect(page.getByText(/请选择与所选模型家族匹配/)).toBeVisible();
  await expect(row).toHaveAttribute('data-installed', 'false');
  await page.evaluate(() => { window.__localImportResult = 'success'; });
  await row.getByRole('button', { name: '导入本地模型' }).click();
  await expect(row).toHaveAttribute('data-installed', 'true');
  await expect(row).toContainText('/external/models/kokoro.gguf');
});
