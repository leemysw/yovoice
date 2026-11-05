import { test, expect } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

const blendLabel = /混合音色|@yovoice\.create\.blendVoices/;
const secondVoiceLabel = /第二音色|@yovoice\.create\.secondVoice/;
const secondWeightLabel = /第二音色比例|@yovoice\.create\.secondVoiceWeight/;

test('Kokoro 混合音色默认关闭，开启为 50% 并随草稿持久化', async ({ page }) => {
  const state = emptyState();
  Object.assign(state.drafts[0], { modelId: 'kokoro-82m-q8', speaker: 'zf_xiaobei', synthesisLanguage: 'auto' });
  await seedState(page, state);
  await page.goto('/');

  const toggle = page.getByRole('switch', { name: blendLabel });
  const secondVoice = page.getByRole('combobox', { name: secondVoiceLabel, exact: true });
  const weight = page.getByRole('slider', { name: secondWeightLabel, exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(secondVoice).toHaveCount(0);
  await expect(weight).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(secondVoice).toContainText('zf_xiaoni');
  await expect(weight).toHaveAttribute('aria-valuenow', '50');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts?.[0]?.speaker))
    .toBe('zf_xiaobei(0.5)+zf_xiaoni(0.5)');

  await page.reload();
  await expect(page.getByRole('switch', { name: blendLabel })).toBeChecked();
  await expect(page.getByRole('combobox', { name: secondVoiceLabel, exact: true })).toContainText('zf_xiaoni');
  await expect(page.getByRole('slider', { name: secondWeightLabel, exact: true })).toHaveAttribute('aria-valuenow', '50');

  await page.getByRole('switch', { name: blendLabel }).click();
  await expect(page.getByRole('combobox', { name: secondVoiceLabel, exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').drafts?.[0]?.speaker))
    .toBe('zf_xiaobei');
});

test('Kokoro 语速控件保存后重新加载仍保持所选语速', async ({ page }) => {
  const state = emptyState();
  Object.assign(state.drafts[0], { modelId: 'kokoro-82m-q8', speaker: 'af_heart', speed: 1.5 });
  await seedState(page, state);
  await page.goto('/');
  const speed = page.getByRole('slider', { name: '语速', exact: true });
  await expect(speed).toHaveAttribute('aria-valuenow', '1.5');
  await speed.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(speed).toHaveAttribute('aria-valuenow', '1.45');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].speed)).toBe(1.45);
  await page.reload();
  await expect(speed).toHaveAttribute('aria-valuenow', '1.45');
});
