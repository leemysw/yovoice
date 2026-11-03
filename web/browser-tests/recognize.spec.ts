import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState, type InstalledModel } from '../src/shared/workbench';

const voice = { id: '0123456789abcdef0123456789abcdef', name: '旁白样本', fileName: 'narrator.wav', duration: 6 };
const recognizer: InstalledModel = { id: 'qwen3-asr-0.6b-q8', path: 'qwen3-asr-0.6b-q8_0.gguf', managed: true };
const mockText = `${voice.name}：浏览器预览不运行识别模型，这是模拟的识别文字。`;
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}'));

// Qwen3-TTS Base 克隆：已选参考声音，原文为空。
async function openClone(page: Page, models: InstalledModel[]) {
  const state = emptyState();
  Object.assign(state.drafts[0], { modelId: 'qwen3-tts-base-q8', text: '测试正文。', voiceId: voice.id, referenceText: '' });
  state.voices = [{ ...voice }];
  state.models = models;
  await seedState(page, state);
  await page.goto('/');
}

test('没装识别模型时在原文框下说明去哪下载', async ({ page }) => {
  await openClone(page, []);
  await page.getByRole('button', { name: '识别文字', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '语音识别模型 Qwen3 ASR' })).toBeVisible();
});

test('识别出的文字填入参考原文，样本原来没有原文时一并保存', async ({ page }) => {
  await openClone(page, [recognizer]);
  await page.getByRole('button', { name: '识别文字', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '参考音频原文（可选）', exact: true })).toHaveValue(mockText);
  await expect.poll(async () => { const s = await saved(page); return [s.drafts?.[0]?.referenceText, s.voices?.[0]?.referenceText, s.transcript]; })
    .toEqual([mockText, mockText, undefined]);
});

test('声音编辑器里识别后可以修改再保存', async ({ page }) => {
  await openClone(page, [recognizer]);
  await page.getByTestId('nav-characters').click();
  await page.getByRole('tab', { name: '参考音频', exact: true }).click();
  await page.getByRole('button', { name: '编辑音色信息', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '识别文字', exact: true }).click();
  const text = dialog.getByLabel('参考原文');
  await expect(text).toHaveValue(mockText);
  await text.fill('改过的原文。');
  await dialog.getByRole('button', { name: '保存音色', exact: true }).click();
  await expect.poll(async () => (await saved(page)).voices?.[0]?.referenceText).toBe('改过的原文。');
});
