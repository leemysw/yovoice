import { expect, test } from '@playwright/test';
import { emptyState, type State } from '../src/shared/workbench';
import { seedState } from './seed';
import catalog from '../../internal/catalog/catalog.json' with { type: 'json' };

const id = 'kokoro-82m-q8';

test('本地模型摘要不同也没有更新入口', async ({ page }) => {
  const state = emptyState();
  state.models = [{ id, path: '/Volumes/Models/local.gguf', managed: false, sha256: '0'.repeat(64) }];
  await seedState(page, state);
  await page.goto('/');
  await expect(page.getByTestId('model-update-notice')).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  const model = page.locator(`[data-model-id="${id}"]`);
  await expect(model.getByText('/Volumes/Models/local.gguf', { exact: true })).toBeVisible();
  await expect(model.getByRole('button', { name: '更新', exact: true })).toHaveCount(0);
  await expect(model.getByRole('combobox', { name: '模型版本' })).toHaveCount(0);
});

test('更新可以暂停和取消，取消后仍保留已安装模型', async ({ page }) => {
  const state = emptyState();
  const installed = { id, path: '/Models/current.gguf', managed: true, sha256: '0'.repeat(64) };
  state.models = [installed];
  state.modelDownloads = { [id]: { version: '1'.repeat(64), received: 120, total: 240, status: 'running' } };
  state.modelActivity = {
    modelId: id, kind: 'download', status: 'running', code: '@yovoice.activity.download', params: null,
    received: 120, total: 240, errorCode: null, errorParams: null,
  };
  await seedState(page, state);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  const model = page.locator(`[data-model-id="${id}"]`);
  const cancel = model.getByRole('button', { name: '取消下载', exact: true });
  await expect(cancel).toBeVisible();
  await expect(model.getByRole('button', { name: '移除模型', exact: true })).toHaveCount(0);
  await model.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(model.getByRole('button', { name: '继续下载', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}') as State;
    return { models: saved.models, jobs: Object.keys(saved.modelDownloads ?? {}) };
  })).toEqual({ models: [installed], jobs: [] });
});

test('切换模型目录后能看到校验进度并取消', async ({ page }) => {
  const state = emptyState();
  state.preferences = { ...state.preferences, introSeen: true, tourSeen: true };
  await page.addInitScript(({ state, catalog }) => {
    let receive: (event: { data: unknown }) => void;
    Object.defineProperty(window, 'chrome', { value: { webview: {
      addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
      postMessage: ({ id, method }: { id: string; method: string }) => {
        queueMicrotask(() => {
          let result: unknown = true;
          if (method === 'state.get') result = { state, catalog: catalog.models, engine: { version: 'v0.9.3', minimum: 'v0.7.4' }, assistant: { available: false } };
          if (method === 'model.directory') {
            state.preferences.modelDirectory = '/Volumes/TD1/Models';
            state.activity = {
              kind: 'import', status: 'running', code: '@yovoice.activity.verifying', params: null,
              received: 512, total: 1024, errorCode: null, errorParams: null,
            };
            receive({ data: { event: 'state', state } });
          }
          if (method === 'operation.cancel') {
            state.activity = null;
            receive({ data: { event: 'state', state } });
          }
          receive({ data: { id, result } });
        });
      },
    } } });
  }, { state, catalog });
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  const changeDirectory = page.getByRole('button', { name: '更改位置', exact: true });
  await changeDirectory.click();
  const activity = page.getByRole('status').filter({ hasText: '正在校验模型' });
  await expect(activity.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '512');
  await expect(activity).toContainText('512 B / 1.00 KB');
  await expect(changeDirectory).toBeDisabled();
  await activity.getByRole('button', { name: '取消', exact: true }).click();
  await expect(activity).toHaveCount(0);
  await expect(changeDirectory).toBeEnabled();
});
