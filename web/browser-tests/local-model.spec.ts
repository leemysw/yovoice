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
  await row.getByRole('radio', { name: 'BF16', exact: true }).click();
  // 导入说明收进按钮提示，不再占一段常驻文字。
  await row.getByRole('button', { name: '导入本地模型' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('导入本地 GGUF 文件');
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

test('扫描目录自动填入 IndexTTS 2.0 和 2.5，确认才批量登记', async ({ page }) => {
  const state = emptyState();
  state.preferences = { ...state.preferences, introSeen: true, tourSeen: true };
  await page.addInitScript(({ state, catalog }) => {
    let receive: (event: { data: unknown }) => void;
    window.__localModelCalls = [];
    Object.defineProperty(window, 'chrome', { value: { webview: {
      addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
      postMessage: (message: { id: string; method: string; data: { id?: string } }) => {
        window.__localModelCalls.push(message);
        let result: unknown = true;
        if (message.method === 'model.import') {
          const error = { code: '@yovoice.error.localModelVersion', params: { actual: '2.0', expected: '2.5' } };
          queueMicrotask(() => receive({ data: { id: message.id, error } }));
          return;
        }
        if (message.method === 'state.get') result = { state, catalog: catalog.models, engine: { version: 'v0.9.3', minimum: 'v0.7.4' }, assistant: { available: false } };
        if (message.method === 'model.scan') result = { directory: '/TD1/models', sources: [
          { path: '/TD1/models/a.gguf', models: ['index-2-q8'] },
          { path: '/TD1/models/b.gguf', models: ['index-2.5-q8'] },
          { path: '/TD1/models/checkpoints', models: ['index-2-q8'], convert: true },
        ] };
        queueMicrotask(() => receive({ data: { id: message.id, result } }));
      },
    } } });
  }, { state, catalog });
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  await page.getByRole('button', { name: '扫描本地模型目录' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: '对应型号' }).nth(0)).toContainText('IndexTTS 2.0 · Q8');
  await expect(dialog.getByRole('combobox', { name: '对应型号' }).nth(1)).toContainText('IndexTTS 2.5 · Q8');
  await expect.poll(() => page.evaluate(() => window.__localModelCalls.some(call => call.method === 'model.importBatch'))).toBe(false);
  await dialog.getByRole('button', { name: '导入选中的模型' }).click();
  await expect.poll(() => page.evaluate(() => window.__localModelCalls.find(call => call.method === 'model.importBatch')?.data)).toEqual({ models: [
    { path: '/TD1/models/a.gguf', id: 'index-2-q8' },
    { path: '/TD1/models/b.gguf', id: 'index-2.5-q8' },
  ] });
  const index25 = page.locator('[data-model-ids~="index-2.5-q8"]');
  await index25.getByRole('button', { name: '导入本地模型' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '这个文件是 IndexTTS 2.0' })).toContainText('当前选的是 2.5');

});
