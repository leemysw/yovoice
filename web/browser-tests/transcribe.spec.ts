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
  await expect(root.getByText('转写需要一个语音识别模型')).toBeVisible();
  await expect(root.getByRole('button', { name: '上传音频', exact: true })).toHaveCount(0);
  await root.getByRole('button', { name: '去下载模型', exact: true }).click();
  // 去下载时直接打开“模型 › 语音识别模型”子页，那里列出全部识别模型。
  await expect(page.getByRole('tab', { name: '语音识别模型', selected: true })).toBeVisible();
  const panel = page.getByRole('tabpanel', { name: '语音识别模型' });
  await expect(panel.getByText('Qwen3 ASR 0.6B')).toBeVisible();
  await expect(panel.getByText('Qwen3 ASR 1.7B', { exact: true })).toBeVisible();
  await expect(panel.getByText('Parakeet TDT 0.6B v3')).toBeVisible();
  await expect(panel.getByText('Confucius4-R2T2', { exact: true })).toBeVisible();
});

test('装了多个识别模型时可以选用哪一个，选择存进偏好', async ({ page }) => {
  await openTranscribe(page, [recognizer, { id: 'parakeet-tdt-0.6b-v3-q8', path: 'parakeet-tdt-0.6b-v3-q8_0.gguf', managed: true }]);
  await page.getByTestId('nav-settings').click();
  await page.getByRole('tab', { name: '模型', exact: true }).click();
  await page.getByRole('tab', { name: '语音识别模型', exact: true }).click();
  const choice = page.getByRole('combobox', { name: '使用的识别模型' });
  await expect(choice).toContainText('Qwen3 ASR 0.6B');
  await choice.click();
  await page.getByRole('option', { name: /Parakeet/ }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-workbench-v1') ?? '{}').preferences?.recognizeModel)).toBe('parakeet-tdt-0.6b-v3-q8');
  // 只装一个时不显示选择。
  await page.getByRole('tab', { name: '语音模型', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '使用的识别模型' })).toHaveCount(0);
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
    // 无头 WebKit 可能没有媒体设备接口。测试用空音轨的流，不申请真实麦克风。
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) },
    });
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

test('字幕行尾按 Delete 与下一行合并；Ctrl+Z / ⌘Z 撤销，Ctrl+Shift+Z、Ctrl+Y / ⇧⌘Z 重做，查找框里不拦截', async ({ page }) => {
  await openTranscribe(page, [recognizer]);
  await upload(page);
  const editor = page.getByTestId('transcript-editor');
  const rows = editor.locator('.transcribe-line');
  await expect(rows).toHaveCount(3);
  const first = editor.getByRole('textbox', { name: '第 1 行字幕' });
  await first.focus();
  // 光标不在行尾时 Delete 只删字，不合并。
  await first.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(0, 0));
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(3);
  await expect(first).toHaveValue('览器预览不运行识别模型');
  await first.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(field.value.length, field.value.length));
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(2);
  await expect(first).toHaveValue('览器预览不运行识别模型这是模拟的转写文字');
  await expect(first).toBeFocused();
  expect(await first.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(11);
  // 撤销合并，再撤销删字；重做两种快捷键都能用。
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(first).toHaveValue('浏览器预览不运行识别模型');
  await expect(editor.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(first).toHaveValue('览器预览不运行识别模型');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
  await expect(rows).toHaveCount(2);
  await expect(editor.getByRole('button', { name: '重做', exact: true })).toBeDisabled();
  // 焦点不在输入框时快捷键也生效；查找框里的 Ctrl+Z 留给输入框自己。
  await editor.getByRole('heading', { name: '采访录音', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(3);
  await editor.getByRole('button', { name: '查找替换', exact: true }).click();
  const find = editor.getByRole('textbox', { name: '查找' });
  await find.fill('转写');
  await expect(rows).toHaveCount(1);
  // 输入框使用平台原生撤销：查找词清空后显示全部行，字幕本身和应用撤销栈保持原状。
  await find.press('ControlOrMeta+z');
  await expect(find).toHaveValue('');
  await expect(rows).toHaveCount(3);
  await expect(first).toHaveValue('览器预览不运行识别模型');
  await expect(editor.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
});

// 预先放好一份带原音频（及原视频）的转写记录：字幕与 WAV 存进预览后端的 IndexedDB。
async function seedTranscript(page: Page, captions: { start: number; end: number; text: string }[], video?: string) {
  const id = 'd'.repeat(32), seconds = 5;
  await page.goto('/');
  await page.evaluate(async ({ id, captions, seconds, video }) => {
    const modulePath = '/src/shared/lib/sound.ts'; const { encodeWav } = await import(/* @vite-ignore */ modulePath);
    const audio = new AudioBuffer({ length: 24000 * seconds, sampleRate: 24000, numberOfChannels: 1 }); audio.getChannelData(0).fill(0.1);
    const files: [string, Blob][] = [[`${id}.wav`, encodeWav(audio)], [`${id}.json`, new Blob([JSON.stringify({ text: '', words: [], captions })], { type: 'application/json' })]];
    // .webm 用画布现录一秒能播的视频，其他扩展名放一个放不了的假文件。
    if (video?.endsWith('.webm')) {
      const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
      const paint = canvas.getContext('2d')!; const timer = setInterval(() => { paint.fillStyle = `hsl(${Date.now() % 360} 60% 50%)`; paint.fillRect(0, 0, 64, 36); }, 40);
      const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' }); const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.start(); setTimeout(() => recorder.stop(), 1000); });
      clearInterval(timer);
      files.push([video, new Blob(chunks, { type: 'video/webm' })]);
    } else if (video) files.push([video, new Blob(['not a video'], { type: 'video/mp4' })]);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('voice-workbench-audio', 1); req.onupgradeneeded = () => req.result.createObjectStore('audio'); req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('audio', 'readwrite'); for (const [name, blob] of files) tx.objectStore('audio').put(blob, name); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  }, { id, captions, seconds, video });
  const state = emptyState();
  state.models = [recognizer];
  state.transcripts = [{ id, name: '访谈', duration: seconds, fileName: `${id}.json`, audioFile: `${id}.wav`, ...(video ? { videoFile: video } : {}), createdAt: new Date().toISOString() }];
  await seedState(page, state);
  await page.reload();
  await page.getByTestId('nav-transcribe').click();
  await page.getByTestId('transcribe-page').getByRole('button', { name: '访谈', exact: true }).click();
  return page.getByTestId('transcript-editor');
}

test('试听一行：连续播放时播完接着播下一行并跳过长静音，关掉后只播这一行', async ({ page }) => {
  const editor = await seedTranscript(page, [{ start: 0, end: .6, text: '第一行' }, { start: .6, end: 1.2, text: '第二行' }, { start: 3.6, end: 4.2, text: '第三行' }]);
  const rows = editor.locator('.transcribe-line');
  const playing = editor.locator('.transcribe-line[data-playing="true"]');
  const toggle = editor.getByRole('button', { name: '连续播放', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await rows.nth(0).getByRole('button', { name: '00:00.000', exact: true }).click();
  await expect(playing).toHaveAttribute('data-line', '0');
  await expect(playing).toHaveAttribute('data-line', '1');
  // 第二行结束到第三行开头空了 2.4 秒，直接跳过去，不用干等。
  await expect(playing).toHaveAttribute('data-line', '2', { timeout: 2000 });
  await expect(playing).toHaveCount(0, { timeout: 3000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await rows.nth(0).getByRole('button', { name: '00:00.000', exact: true }).click();
  await expect(playing).toHaveAttribute('data-line', '0');
  await expect(playing).toHaveCount(0, { timeout: 3000 });
  expect(await editor.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeLessThan(1);
  // 开关记在本机，重新打开仍是关闭。
  await page.reload();
  await page.getByTestId('nav-transcribe').click();
  await page.getByTestId('transcribe-page').getByRole('button', { name: '访谈', exact: true }).click();
  await expect(editor.getByRole('button', { name: '连续播放', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('试听中途空格暂停再继续：接着按行试听，关掉连续播放时仍停在这一行结尾', async ({ page }) => {
  const editor = await seedTranscript(page, [{ start: 0, end: 2, text: '第一行' }, { start: 2, end: 2.5, text: '第二行' }]);
  await editor.getByRole('button', { name: '连续播放', exact: true }).click();
  const playing = editor.locator('.transcribe-line[data-playing="true"]');
  const audio = editor.locator('audio');
  await editor.getByRole('button', { name: '00:00.000', exact: true }).click();
  await expect(playing).toHaveAttribute('data-line', '0');
  await page.keyboard.press('Space');
  await expect(playing).toHaveCount(0);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.keyboard.press('Space');
  await expect(playing).toHaveAttribute('data-line', '0');
  // 继续的仍是这一行的试听：播到行尾停下，不接着播第二行。
  await expect(playing).toHaveCount(0, { timeout: 4000 });
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(2.3);
});

test('翻页后上一行 / 下一行留在当前页：没有焦点行时从本页第一行开始，翻页快捷键把光标放到新页第一行', async ({ page }) => {
  const captions = Array.from({ length: 60 }, (_, i) => ({ start: i * .08, end: i * .08 + .07, text: `第 ${i + 1} 句` }));
  const editor = await seedTranscript(page, captions);
  const line = (n: number) => editor.getByRole('textbox', { name: `第 ${n} 行字幕`, exact: true });
  await expect(line(1)).toBeVisible();
  // 用按钮翻到第 2 页，焦点不在任何一行里：⌥↓ 落在第 2 页第一行，而不是跳回第 1 页。
  await editor.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(line(51)).toBeVisible();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(line(51)).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(line(52)).toBeFocused();
  // 翻页快捷键：翻过去后光标在新页第一行。
  await page.keyboard.press('ControlOrMeta+Shift+BracketLeft');
  await expect(line(1)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+BracketRight');
  await expect(line(51)).toBeFocused();
});

test('原文件是视频时显示画面；视频放不了时提示并退回只播原音频', async ({ page }) => {
  const editor = await seedTranscript(page, [{ start: 0, end: .6, text: '第一行' }], 'd'.repeat(32) + '.mp4');
  await expect(editor.getByText('这个视频无法在这里播放，改为只播放声音')).toBeVisible();
  await expect(editor.locator('video')).toHaveCount(0);
  await editor.getByRole('button', { name: '00:00.000', exact: true }).click();
  await expect(editor.locator('.transcribe-line[data-playing="true"]')).toHaveAttribute('data-line', '0');
});

test('视频在上、字幕在下：空格播放暂停，字幕里打字时空格照常输入；拖动分隔条调整画面高度，记在本机', async ({ page }) => {
  const captions = Array.from({ length: 30 }, (_, i) => ({ start: i * .03, end: i * .03 + .03, text: `第 ${i + 1} 句` }));
  const editor = await seedTranscript(page, captions, 'd'.repeat(32) + '.webm');
  const video = editor.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  const paused = () => video.evaluate((element: HTMLVideoElement) => element.paused);
  await page.keyboard.press('Space');
  await expect.poll(paused).toBe(false);
  await page.keyboard.press('Space');
  await expect.poll(paused).toBe(true);
  // 光标在字幕里时空格是文字，不播放。
  const line = editor.getByRole('textbox', { name: '第 1 行字幕', exact: true });
  await line.click(); await page.keyboard.press('End'); await page.keyboard.press('Space');
  await expect(line).toHaveValue('第 1 句 ');
  expect(await paused()).toBe(true);
  // 焦点在视频上时空格交给视频自己，只切换一次，不会刚播放就又停下。
  await video.focus();
  await page.keyboard.press('Space');
  await expect.poll(paused).toBe(false);
  await page.waitForTimeout(200);
  expect(await paused()).toBe(false);
  await page.keyboard.press('Space');
  await expect.poll(paused).toBe(true);
  // 分隔条可用键盘调整：画面变高，重新打开后保持。
  const stage = editor.locator('.transcribe-video');
  const before = (await stage.boundingBox())!.height;
  const handle = editor.getByRole('separator', { name: '调整视频大小', exact: true });
  await handle.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await stage.boundingBox())!.height).toBeGreaterThan(before + 20);
  const after = (await stage.boundingBox())!.height;
  await page.reload();
  await page.getByTestId('nav-transcribe').click();
  await page.getByTestId('transcribe-page').getByRole('button', { name: '访谈', exact: true }).click();
  await expect.poll(async () => Math.round((await editor.locator('.transcribe-video').boundingBox())?.height ?? 0)).toBe(Math.round(after));
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

declare global { interface Window { __transcribeTrackCalls: { method: string; data: unknown }[] } }

test('多音轨上传可取消或选择指定音轨，确认时不重复上传', async ({ page }) => {
  const state = emptyState();
  state.models = [recognizer];
  state.preferences = { ...state.preferences, introSeen: true, tourSeen: true };
  await page.addInitScript(state => {
    window.__transcribeTrackCalls = [];
    let receive: (event: { data: unknown }) => void;
    Object.defineProperty(window, 'chrome', { value: { webview: {
      addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
      postMessage: (message: { id: string; method: string; data: unknown }) => queueMicrotask(() => {
        if (message.method.startsWith('speech.transcribe.')) window.__transcribeTrackCalls.push({ method: message.method, data: message.data });
        const result = message.method === 'state.get' ? { state, catalog: [], engine: { version: 'v0.9.3' }, assistant: { available: false } } : true;
        receive({ data: { id: message.id, result } });
      }),
    } } });
  }, state);
  let uploads = 0;
  await page.route('**/api/transcribe?*', route => {
    uploads++;
    return route.fulfill({ json: { result: { id: String(uploads), tracks: [
      { number: 1, language: 'eng', title: 'English', default: true, codec: 'aac' },
      { number: 2, language: 'jpn', title: '日本語', codec: 'eac3' },
    ] } } });
  });
  await page.goto('/');
  await page.getByTestId('nav-transcribe').click();
  await upload(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '选择转写音轨' })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__transcribeTrackCalls)).toEqual([{ method: 'speech.transcribe.discard', data: { id: '1' } }]);
  await upload(page);
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: /音轨 2.*日本語.*EAC3/ }).click();
  await dialog.getByRole('button', { name: '转写所选音轨' }).click();
  await expect.poll(() => page.evaluate(() => window.__transcribeTrackCalls[1])).toEqual({
    method: 'speech.transcribe.select', data: { id: '2', name: '采访录音.mp3', track: 2 },
  });
  expect(uploads).toBe(2);
});
