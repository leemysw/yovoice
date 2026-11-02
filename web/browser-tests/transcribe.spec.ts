import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { seedState } from './seed';
import { openProjectHistory } from './project-actions';
import { emptyState, type InstalledModel } from '../src/shared/workbench';
import { spokenText, wordCaptions } from '../src/features/media/caption-export';

// 语音转写页与语音版本导出字幕：逐词时间按句分行，导出 SRT / WebVTT。

const recognizer: InstalledModel = { id: 'qwen3-asr-0.6b-q8', path: 'Qwen3-ASR-GGUF', managed: true };
const timed = (words: string[], step = .5, gap = .4) => words.map((word, i) => ({ word, start: i * step, end: i * step + gap }));

test('逐词时间按句末、分句、宽度和停顿分行，保留问号去掉句号', () => {
  expect(wordCaptions('你好，世界。今天很好！', timed([...'你好世界今天很好']))).toEqual([
    { start: 0, end: 1.9, text: '你好，世界' },
    { start: 2, end: 3.9, text: '今天很好！' },
  ]);
  // 英文按单词定位原文，保留大小写和标点；停顿超过 0.8 秒另起一行。
  const words = [...timed(['hello', 'world']), { word: 'are', start: 3, end: 3.2 }, { word: 'you', start: 3.3, end: 3.5 }, { word: 'there', start: 3.6, end: 4 }];
  expect(wordCaptions('Hello, World... are you there?', words)).toEqual([
    { start: 0, end: .9, text: 'Hello, World...' },
    { start: 3, end: 4, text: 'are you there?' },
  ]);
  // 超过宽度就换行，相邻两行不重叠。
  const long = wordCaptions('一二三四五六七八九十一二三四五六七八九十一二三', timed([...'一二三四五六七八九十一二三四五六七八九十一二三'], .2, .5));
  expect(long.map(c => c.text)).toEqual(['一二三四五六七八九十一二三四五六七八九十', '一二三']);
  expect(long[0].end).toBe(long[1].start);
  // 原文找不到识别的词时直接拼接识别结果。
  expect(wordCaptions('', timed(['good', 'morning'])).map(c => c.text)).toEqual(['good morning']);
  expect(spokenText('[laugh]你好 [breath]世界')).toBe('你好 世界');
});

async function openTranscribe(page: Page, models: InstalledModel[]) {
  const state = emptyState();
  state.models = models;
  await seedState(page, state);
  await page.goto('/');
  await page.getByTestId('nav-transcribe').click();
}
const upload = (page: Page) => page.getByTestId('transcribe-page').locator('input[type=file]').setInputFiles({ name: '采访录音.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('mp3') });

test('没装识别模型时转写页说明原因并可去下载', async ({ page }) => {
  await openTranscribe(page, []);
  await expect(page.getByRole('heading', { name: '语音转写', exact: true })).toBeVisible();
  await upload(page);
  await expect(page.getByRole('alert').filter({ hasText: '语音识别模型 Qwen3 ASR' })).toBeVisible();
  await page.getByRole('button', { name: '去下载模型', exact: true }).click();
  await expect(page.getByText('Qwen3 ASR 0.6B').first()).toBeVisible();
});

test('上传音频转写出按句分行的字幕，可导出 SRT / WebVTT 并清除', async ({ page }, testInfo) => {
  await openTranscribe(page, [recognizer]);
  await upload(page);
  const result = page.getByTestId('transcribe-page');
  await expect(result.getByText('采访录音', { exact: true })).toBeVisible();
  await expect(result.locator('tbody tr')).toHaveCount(3);
  await expect(result.locator('tbody tr').first()).toContainText('浏览器预览不运行识别模型');
  await page.screenshot({ path: testInfo.outputPath('transcribe.png') });
  const exportAs = async (name: string, file: string) => {
    const download = page.waitForEvent('download');
    await result.getByRole('button', { name, exact: true }).click();
    const saved = await download;
    await saved.saveAs(testInfo.outputPath(file));
    return readFile(testInfo.outputPath(file), 'utf8');
  };
  expect(await exportAs('导出 SRT', '采访录音.srt')).toBe('1\n00:00:00,000 --> 00:00:03,550\n浏览器预览不运行识别模型\n\n2\n00:00:03,600 --> 00:00:06,250\n这是模拟的转写文字\n\n3\n00:00:06,300 --> 00:00:09,550\n用来演示字幕分行和导出！\n');
  expect((await exportAs('导出 WebVTT', '采访录音.vtt')).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:03.550\n浏览器预览不运行识别模型\n')).toBe(true);
  await result.getByRole('button', { name: '清除', exact: true }).click();
  await expect(result.getByText('把录音、访谈或视频里的话转成文字')).toBeVisible();
});

test('语音版本导出字幕：先对齐正文时间，保存在版本上，再按句导出', async ({ page }, testInfo) => {
  const state = emptyState();
  const id = 'c'.repeat(32);
  state.models = [recognizer];
  state.history = [{ id, title: '问候', fileName: `${id}.wav`, createdAt: new Date().toISOString(), duration: 4, settings: { ...state.drafts[0], text: '[laugh]你好，世界。今天很好！' } }];
  await seedState(page, state);
  await page.goto('/');
  await page.locator('.recent-projects .project-link').first().click();
  await openProjectHistory(page);
  await page.getByRole('button', { name: '音频操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '导出字幕', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('首次导出会先用语音识别模型把正文对齐到音频上');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  const saved = await download;
  await saved.saveAs(testInfo.outputPath('caption.srt'));
  expect(await readFile(testInfo.outputPath('caption.srt'), 'utf8')).toBe('1\n00:00:00,000 --> 00:00:01,900\n你好，世界\n\n2\n00:00:02,000 --> 00:00:03,900\n今天很好！\n');
  await expect(dialog).toHaveCount(0);
  // 再次导出直接用保存的时间。
  await page.getByRole('button', { name: '音频操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '导出字幕', exact: true }).click();
  await expect(dialog).toContainText('字幕时间已对齐');
});
