import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

async function openModel(page: Parameters<typeof seedState>[0], modelId: string, patch: Partial<ReturnType<typeof emptyState>['drafts'][number]> = {}) {
  const state = emptyState();
  Object.assign(state.drafts[0], { modelId, text: '测试正文。' }, patch);
  await seedState(page, state);
  await page.goto('/');
}

test('Voxtral 按语言分组选择内置音色', async ({ page }) => {
  await openModel(page, 'voxtral-tts-4b-q8');
  const speaker = page.getByRole('combobox', { name: '内置音色', exact: true });
  await expect(speaker).toContainText('casual_male');
  await speaker.click();
  await expect(page.getByRole('option', { name: 'fr_female', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'hi_female', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'fr_female', exact: true }).click();
  await expect(speaker).toContainText('fr_female');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts?.[0]?.speaker)).toBe('fr_female');
});

test('Plapre 在内置音色和克隆之间切换', async ({ page }) => {
  await openModel(page, 'plapre-3-bf16');
  const speaker = page.getByRole('combobox', { name: '内置音色', exact: true });
  await expect(speaker).toContainText('tor');
  await speaker.click();
  await page.getByRole('option', { name: 'ida', exact: true }).click();
  await expect(speaker).toContainText('ida');
  await page.getByRole('radio', { name: '音色克隆', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加参考音频', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '参考音频原文（可选）', exact: true })).toBeVisible();
  await expect(speaker).toHaveCount(0);
  await page.getByRole('radio', { name: '内置音色', exact: true }).click();
  await expect(speaker).toContainText('ida');
});

test('XTTS 提供 17 种语言且缺少参考音频时先打开选择器', async ({ page }) => {
  // 从其他模型切换过来时语言为 auto，XTTS 按简体中文显示。
  await openModel(page, 'xtts-v2-q8', { synthesisLanguage: 'auto' });
  const language = page.getByRole('combobox', { name: '语言', exact: true });
  await expect(language).toContainText('简体中文');
  await language.click();
  await expect(page.getByRole('option')).toHaveCount(17);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '生成语音', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '选择参考音频', exact: true })).toBeVisible();
});

test('Drama 3 克隆原文必填', async ({ page }) => {
  await openModel(page, 'fish-drama3-small-iq3');
  await page.getByRole('radio', { name: '音色克隆', exact: true }).click();
  const transcript = page.getByRole('textbox', { name: '参考音频原文 必填', exact: true });
  await expect(transcript).toHaveAttribute('aria-required', 'true');
  await expect(transcript).toHaveValue('');
  await transcript.fill('逐字参考原文。');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts?.[0]?.referenceText)).toBe('逐字参考原文。');
});

test('Audio8 TTS 默认音色不带声音描述，克隆原文必填', async ({ page }) => {
  await openModel(page, 'audio8-tts-0.6b-q8');
  await expect(page.getByRole('radio', { name: '默认音色', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: '声音描述', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: '音色克隆', exact: true }).click();
  const transcript = page.getByRole('textbox', { name: '参考音频原文 必填', exact: true });
  await expect(transcript).toHaveAttribute('aria-required', 'true');
  await transcript.fill('逐字参考原文。');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts?.[0]?.referenceText)).toBe('逐字参考原文。');
});
