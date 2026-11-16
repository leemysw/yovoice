import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState } from '../src/shared/workbench';

async function openPicker(page: Page, duration = 2) {
  const state = emptyState();
  Object.assign(state.drafts[0], { modelId: 'qwen3-tts-base-q8', voiceId: null });
  state.history = [{ id: 'a'.repeat(32), title: '生成的旁白', fileName: 'history.wav', createdAt: new Date().toISOString(), duration, settings: { ...state.drafts[0], text: '历史音频的完整原文。', temperature: 0.42, seed: 123, modelOptions: { qwen3_tts: { top_k: 31, do_sample: false } } } }];
  await seedState(page, state);
  await page.goto('/');
  // 与生成历史共用同一音频存储，确保选择器读到真实的 WAV。
  await page.evaluate(async duration => {
    const path = '/src/shared/lib/preview/blobs.ts';
    const { blobStore } = await import(path);
    const samples = 16000 * duration;
    const data = new ArrayBuffer(44 + samples * 2), view = new DataView(data);
    const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
    await blobStore('history.wav', new Blob([data], { type: 'audio/wav' }));
  }, duration);
  await page.getByRole('button', { name: '添加参考音频', exact: true }).click();
  return page.getByRole('dialog');
}

test('从历史选择语音保留原文和来源，应用后独立于原音频', async ({ page }) => {
  const dialog = await openPicker(page);
  await dialog.getByRole('radio', { name: '生成历史', exact: true }).click();
  await dialog.getByRole('textbox', { name: '搜索生成的语音' }).fill('不存在');
  await expect(dialog.getByRole('button', { name: '生成的旁白', exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: '搜索生成的语音' }).fill('完整原文');
  await dialog.getByRole('button', { name: '试听生成的旁白', exact: true }).click();
  await dialog.getByRole('button', { name: '生成的旁白', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '参考原文', exact: true })).toHaveValue('历史音频的完整原文。');
  await dialog.getByRole('button', { name: '另存为新音色', exact: true }).click();
  await dialog.getByRole('button', { name: '使用所选参考音频', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('voice-workbench-v1')!);
    const voice = state.voices.find((v: { id: string }) => v.id === state.drafts[0].voiceId);
    return voice && { source: voice.source, id: voice.sourceGenerationId, text: state.drafts[0].referenceText, independent: voice.fileName !== 'history.wav' };
  })).toEqual({ source: 'generation', id: 'a'.repeat(32), text: '历史音频的完整原文。', independent: true });
});

test('长历史音频先选段，修改范围后不沿用整段台词', async ({ page }) => {
  const dialog = await openPicker(page, 65);
  await dialog.getByRole('radio', { name: '生成历史', exact: true }).click();
  await dialog.getByRole('button', { name: '生成的旁白', exact: true }).click();
  const transcript = dialog.getByRole('textbox', { name: '参考原文', exact: true });
  await expect(transcript).toHaveValue('');
  await transcript.fill('旧节选原文');
  await dialog.getByRole('spinbutton', { name: '出点（秒）', exact: true }).fill('5');
  await dialog.getByRole('spinbutton', { name: '出点（秒）', exact: true }).press('Tab');
  await expect(transcript).toHaveValue('');
  await transcript.fill('节选中的台词。');
  await dialog.getByRole('button', { name: '试听选段', exact: true }).click();
  await dialog.getByRole('button', { name: '另存为新音色', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const voice = JSON.parse(localStorage.getItem('voice-workbench-v1')!).voices.at(-1);
    return voice && { duration: voice.duration, text: voice.referenceText, source: voice.sourceGenerationId };
  })).toEqual({ duration: 5, text: '节选中的台词。', source: 'a'.repeat(32) });
});

test('拖入音频复用文件导入流程，错误后可继续导入', async ({ page }) => {
  const dialog = await openPicker(page);
  const drop = dialog.locator('[data-mode="dropzone"]');
  const invalid = await page.evaluateHandle(() => {
    const data = new DataTransfer(); data.items.add(new File(['broken'], '损坏.wav', { type: 'audio/wav' })); return data;
  });
  await drop.dispatchEvent('drop', { dataTransfer: invalid });
  await expect(dialog.getByRole('alert')).toBeVisible();
  const transfer = await page.evaluateHandle(async () => {
    const path = '/src/shared/lib/preview/blobs.ts'; const { blobStore } = await import(path);
    const data = new DataTransfer(); data.items.add(new File([await blobStore('history.wav')], '拖入的音色.wav', { type: 'audio/wav' })); return data;
  });
  await drop.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: '使用所选参考音频', exact: true }).click();
  await expect(page.getByRole('button', { name: '拖入的音色', exact: true })).toBeVisible();
});

test('CustomVoice 将音色与风格指导分开说明', async ({ page }) => {
  const state = emptyState();
  state.drafts[0].modelId = 'qwen3-tts-customvoice-q8';
  await seedState(page, state); await page.goto('/');
  await expect(page.getByRole('combobox', { name: '内置音色', exact: true })).toBeVisible();
  const style = page.getByRole('textbox', { name: '风格指导（可选）', exact: true });
  await expect(style).toBeVisible();
  await expect(page.getByRole('textbox', { name: '声音描述', exact: true })).toHaveCount(0);
  await style.fill('语速轻快');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1')!).drafts[0].voiceDescription)).toBe('语速轻快');
});


test('历史配置读取生成快照而非当前草稿，并可导出原参数', async ({ page }) => {
  const picker = await openPicker(page);
  await picker.getByRole('radio', { name: '生成历史', exact: true }).click();
  await picker.getByRole('button', { name: '生成配置', exact: true }).click();
  const details = page.getByRole('dialog', { name: '生成配置', exact: true });
  await expect(details).toContainText('Qwen3-TTS 1.7B Base · Q8');
  await expect(details).toContainText('123');
  const text = details.getByRole('textbox', { name: '生成文字', exact: true });
  await expect(text).toHaveValue('历史音频的完整原文。');
  await expect(text).toHaveAttribute('readonly');
  const pending = page.waitForEvent('download');
  await details.getByRole('button', { name: '导出生成配置', exact: true }).click();
  const result = await pending;
  const { readFile } = await import('node:fs/promises');
  const saved = JSON.parse(await readFile((await result.path())!, 'utf8'));
  expect(saved.settings.temperature).toBe(0.42);
  expect(saved.settings.text).toBe('历史音频的完整原文。');
  expect(saved.settings.seed).toBe(123);
  expect(saved.settings.modelOptions.qwen3_tts).toEqual({ top_k: 31, do_sample: false });
  await details.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '历史生成', exact: true }).click();
  await page.getByRole('button', { name: '生成配置', exact: true }).click();
  await expect(details.getByRole('textbox', { name: '生成文字', exact: true })).toHaveValue('历史音频的完整原文。');
});
