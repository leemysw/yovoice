import { expect, test } from '@playwright/test';
import { emptyState, type State } from '../src/shared/workbench';
import { seedState } from './seed';

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
