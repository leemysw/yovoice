import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { seedState } from './seed';
import { openProjectHistory } from './project-actions';
import { emptyState, type InstalledModel } from '../src/shared/workbench';
import { findRows, joinText, mergeNext, replaceAll, splitAt } from '../src/features/transcribe/caption-edit';

// 语音转写页与语音版本导出字幕：逐词时间按句分行，转写记录保存后可编辑字幕，导出 SRT / WebVTT。

const recognizer: InstalledModel = { id: 'qwen3-asr-0.6b-q8', path: 'Qwen3-ASR-GGUF', managed: true };
const timed = (words: string[], step = .5, gap = .4) => words.map((word, i) => ({ word, start: i * step, end: i * step + gap }));

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
  const root = page.getByTestId('transcribe-page');
  await expect(root.getByRole('heading', { name: '语音转写', exact: true })).toBeVisible();
  await expect(root.getByText('转写需要语音识别模型 Qwen3 ASR')).toBeVisible();
  await expect(root.getByRole('button', { name: '上传音频', exact: true })).toHaveCount(0);
  await root.getByRole('button', { name: '去下载模型', exact: true }).click();
  await expect(page.getByText('Qwen3 ASR 0.6B').first()).toBeVisible();
});

test('字幕编辑：合并相连文字、按逐词时间拆分、查找替换', () => {
  expect([joinText('你好，', '世界'), joinText('hello', 'world'), joinText('', ' a ')]).toEqual(['你好，世界', 'hello world', 'a']);
  const lines = [{ start: 0, end: 1, text: '你好' }, { start: 1.2, end: 2, text: '世界' }, { start: 2.5, end: 3, text: 'Hello' }];
  expect(mergeNext(lines, 0)).toEqual([{ start: 0, end: 2, text: '你好世界' }, lines[2]]);
  expect(mergeNext(lines, 2)).toBe(lines);
  // 光标在“今天”之后：前一行在“天”结束，后一行从“很”开始；定位不到词时按字数比例。
  const words = timed([...'今天很好']);
  expect(splitAt([{ start: 0, end: 1.9, text: '今天很好' }], 0, 2, words)).toEqual([{ start: 0, end: .9, text: '今天' }, { start: 1, end: 1.9, text: '很好' }]);
  expect(splitAt([{ start: 0, end: 4, text: 'abcd' }], 0, 1, [])).toEqual([{ start: 0, end: 1, text: 'a' }, { start: 1, end: 4, text: 'bcd' }]);
  expect(splitAt(lines, 0, 0, [])).toBeNull();
  expect(findRows(lines, 'hello')).toEqual([2]);
  const replaced = replaceAll([...lines, { start: 3, end: 4, text: '你好你好' }], '你好', '您好');
  expect(replaced.count).toBe(3);
  expect(replaced.captions.map(c => c.text)).toEqual(['您好', '世界', 'Hello', '您好您好']);
  expect(replaceAll(lines, '没有', 'x').captions).toBe(lines);
});

test('上传音频转写后保存为记录：编辑字幕自动保存，重新打开仍在，导出编辑后的字幕，可删除', async ({ page }, testInfo) => {
  await openTranscribe(page, [recognizer]);
  await upload(page);
  const editor = page.getByTestId('transcript-editor');
  await expect(editor.getByRole('heading', { name: '采访录音', exact: true })).toBeVisible();
  const rows = editor.locator('.transcribe-line');
  await expect(rows).toHaveCount(3);
  await expect(editor.getByRole('textbox', { name: '第 1 行字幕' })).toHaveValue('浏览器预览不运行识别模型');
  await page.screenshot({ path: testInfo.outputPath('transcribe.png') });
  // 合并第一行和第二行，再在“预览”后拆开，改一处文字，查找替换。
  // 行首退格与上一行合并，光标落在接缝处；回车在光标处拆开。
  const second = editor.getByRole('textbox', { name: '第 2 行字幕' });
  await second.focus();
  await second.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(0, 0));
  await page.keyboard.press('Backspace');
  await expect(rows).toHaveCount(2);
  const first = editor.getByRole('textbox', { name: '第 1 行字幕' });
  await expect(first).toHaveValue('浏览器预览不运行识别模型这是模拟的转写文字');
  await expect(first).toBeFocused();
  expect(await first.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(12);
  await first.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(5, 5));
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(3);
  await expect(second).toHaveValue('不运行识别模型这是模拟的转写文字');
  await expect(second).toBeFocused();
  // 行操作按钮：与下一行合并后再用剪刀在原处拆开。
  await rows.nth(0).getByRole('button', { name: '与下一行合并', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await first.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(5, 5));
  await rows.nth(0).getByRole('button', { name: '在光标处拆分', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await editor.getByRole('textbox', { name: '第 3 行字幕' }).fill('用来演示字幕编辑！');
  await editor.getByRole('button', { name: '查找替换', exact: true }).click();
  await editor.getByRole('textbox', { name: '查找' }).fill('模拟');
  await expect(rows).toHaveCount(1);
  await editor.getByRole('textbox', { name: '替换为' }).fill('示例');
  await editor.getByRole('button', { name: '全部替换', exact: true }).click();
  await expect(editor.getByText('已替换 1 处')).toBeVisible();
  await editor.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: '第 2 行字幕' })).toHaveValue('不运行识别模型这是模拟的转写文字');
  await editor.getByRole('button', { name: '全部替换', exact: true }).click();
  await editor.getByRole('button', { name: '查找替换', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(editor.getByText('已自动保存')).toBeVisible();
  // 重新加载后从列表打开，编辑后的字幕还在。
  await page.reload();
  await page.getByTestId('nav-transcribe').click();
  await page.getByTestId('transcribe-page').getByRole('button', { name: '采访录音', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: '第 2 行字幕' })).toHaveValue('不运行识别模型这是示例的转写文字');
  const download = page.waitForEvent('download');
  await editor.getByRole('button', { name: '导出字幕', exact: true }).click();
  await page.getByRole('menuitem', { name: '导出 SRT', exact: true }).click();
  const saved = await download;
  await saved.saveAs(testInfo.outputPath('采访录音.srt'));
  expect(await readFile(testInfo.outputPath('采访录音.srt'), 'utf8')).toBe('1\n00:00:00,000 --> 00:00:01,450\n浏览器预览\n\n2\n00:00:01,500 --> 00:00:06,250\n不运行识别模型这是示例的转写文字\n\n3\n00:00:06,300 --> 00:00:09,550\n用来演示字幕编辑！\n');
  await editor.getByRole('button', { name: '「采访录音」的更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除转写', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除转写', exact: true }).click();
  await expect(page.getByTestId('transcribe-page').getByText('把录音、访谈或视频里的话转成文字')).toBeVisible();
});

test('录音后直接转写：停止录音即上传，新记录自动打开；放弃录音不转写', async ({ page }) => {
  await page.addInitScript(() => {
    // 模拟麦克风：getUserMedia 返回没有音轨的流，MediaRecorder 停止时交出一小段数据。
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    class FakeRecorder extends EventTarget {
      state = 'inactive'; mimeType = 'audio/webm'; stream: MediaStream;
      ondataavailable: ((event: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null;
      constructor(stream: MediaStream) { super(); this.stream = stream; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['webm'], { type: 'audio/webm' }) }); this.onstop?.(); }
    }
    Object.assign(window, { MediaRecorder: FakeRecorder });
  });
  await openTranscribe(page, [recognizer]);
  const pageRoot = page.getByTestId('transcribe-page');
  await pageRoot.getByRole('button', { name: '录音', exact: true }).click();
  await expect(pageRoot.getByRole('timer')).toBeVisible();
  await pageRoot.getByRole('button', { name: '放弃录音', exact: true }).click();
  await expect(pageRoot.getByRole('timer')).toHaveCount(0);
  await expect(pageRoot.getByText('把录音、访谈或视频里的话转成文字')).toBeVisible();
  await pageRoot.getByRole('button', { name: '录音', exact: true }).click();
  await pageRoot.getByRole('button', { name: '停止并转写', exact: true }).click();
  await expect(page.getByTestId('transcript-editor').getByRole('heading', { name: /^录音 / })).toBeVisible();
  await expect(page.getByTestId('transcript-editor').locator('.transcribe-line')).toHaveCount(3);
  // 返回列表：票根显示名称与字幕摘录；从更多操作重命名。
  await page.getByRole('button', { name: '返回转写列表', exact: true }).click();
  await expect(pageRoot.getByText('「浏览器预览不运行识别模型')).toBeVisible();
  await pageRoot.getByRole('button', { name: /^「录音 .*」的更多操作$/ }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: '转写名称' }).fill('周会');
  await page.getByRole('dialog').getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(pageRoot.getByRole('button', { name: '周会', exact: true })).toBeVisible();
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
