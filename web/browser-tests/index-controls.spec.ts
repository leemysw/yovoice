import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

for (const supported of [false, true]) {
  test(`IndexTTS 2.5 只展示当前引擎明确支持的文本参数：${supported}`, async ({ page }) => {
    const state = emptyState();
    if (supported) state.runtimeOptions = { index_tts2: ['max_text_tokens_per_segment', 'text_normalization'] };
    await seedState(page, state);
    await page.goto('/');
    await page.locator('summary').filter({ hasText: '高级设置' }).click();
    const budget = page.getByLabel('每段文本 Token 上限');
    const normalize = page.getByRole('switch', { name: '规范化数字与符号' });
    if (!supported) {
      await expect(budget).toHaveCount(0);
      await expect(normalize).toHaveCount(0);
      return;
    }
    await expect(budget).toHaveValue('120');
    await expect(normalize).toBeChecked();
    await budget.fill('60');
    await normalize.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].modelOptions?.index_tts2)).toMatchObject({ max_text_tokens_per_segment: 60, text_normalization: false });
    await page.reload();
    await page.locator('summary').filter({ hasText: '高级设置' }).click();
    await expect(budget).toHaveValue('60');
    await expect(normalize).not.toBeChecked();
  });
}

test('IndexTTS 2.0 展示内部 token 分段，保留固定的文本规范化流程', async ({ page }) => {
  const state = emptyState();
  state.drafts[0].modelId = 'index-2-q8';
  state.runtimeOptions = { index_tts2: ['max_text_tokens_per_segment', 'text_normalization'] };
  await seedState(page, state);
  await page.goto('/');
  await page.locator('summary').filter({ hasText: '高级设置' }).click();
  await expect(page.getByLabel('每段文本 Token 上限')).toBeVisible();
  await expect(page.getByRole('switch', { name: '规范化数字与符号' })).toHaveCount(0);
});

test('旧引擎上的新版作品可以重置不兼容选项，保留其他分段设置', async ({ page }) => {
  const state = emptyState();
  state.drafts[0].modelOptions = { index_tts2: { max_text_tokens_per_segment: 60, text_chunk_size: 200 } };
  await seedState(page, state);
  await page.goto('/');
  await page.locator('summary').filter({ hasText: '高级设置' }).click();
  await expect(page.getByRole('status').filter({ hasText: '当前推理引擎不支持参数' })).toBeVisible();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].modelOptions?.index_tts2)).toEqual({ text_chunk_size: 200 });
});
