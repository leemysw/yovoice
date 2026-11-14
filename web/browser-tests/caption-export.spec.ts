import { test, expect, type Page } from '@playwright/test';
import { seedState } from './seed';
import { emptyState, type AudioTimeline, type Draft, type Generation } from '../src/shared/workbench';
import { Timeline } from '../src/features/media/timeline';
import { srtTime, timelineCaptions } from '../src/features/media/caption-export';
import { lrcTime, lyricTimeline, lyricsToLrc } from '../src/features/music/lyric-timing';
import { createMusicDraft } from '../src/features/music/music-draft';

// 故事配音导出字幕的时间区间与说话人过滤、音乐播放页导出 LRC 歌词；SRT/WebVTT 排版在 Go 的 schema 测试里。

const speakers = [{ id: 'a', sourceName: '旁白' }, { id: 'b', sourceName: '小明' }];
function segment(id: string, text: string, speakerId: string, draft: Draft): Generation {
  return { id, title: text, fileName: 'segments.wav', createdAt: '2026-10-18T10:00:00Z', duration: 3, settings: { ...draft, subtitles: undefined, text }, segment: { batchId: 'batch', index: 0, cueId: `cue-${id}`, speakerId, speakerName: speakerId === 'a' ? '旁白' : '小明' } };
}

test('字幕与歌词时间格式：毫秒和百分之一秒取整进位', () => {
  expect(srtTime(0)).toBe('00:00:00,000');
  expect(srtTime(3661.2345)).toBe('01:01:01,235');
  expect(srtTime(59.9996)).toBe('00:01:00,000');
  expect(srtTime(-1)).toBe('00:00:00,000');
  expect(lrcTime(0)).toBe('[00:00.00]');
  expect(lrcTime(65.437)).toBe('[01:05.44]');
  expect(lrcTime(59.996)).toBe('[01:00.00]');
  expect(lrcTime(6000)).toBe('[100:00.00]');
});

test('字幕按片段实际播放区间计时：裁剪、所选范围、静音音轨与说话人过滤', () => {
  const draft = emptyState().drafts[0];
  const history = [segment('g1', '第一句', 'a', draft), segment('g2', '第二句\n\n换行', 'b', draft), segment('g3', '<静音>', 'a', draft)];
  const value: AudioTimeline = { tracks: [
    { id: 't1', name: '对白', muted: false, clips: [{ id: 'c1', generationId: 'g1', start: 0, offset: 0, duration: 3 }, { id: 'c2', generationId: 'g2', start: 4, offset: 0, duration: 3 }] },
    { id: 't2', name: '静音', muted: true, clips: [{ id: 'c3', generationId: 'g3', start: 1, offset: 0, duration: 3 }] },
    { id: 't3', name: '素材', muted: false, clips: [{ id: 'c4', assetId: 'bgm', start: 0, offset: 0, duration: 10 }] },
  ] };
  // 裁掉第一句开头 0.5 秒：片段起点后移，字幕跟随实际位置而不是原字幕时间。
  const trimmed = Timeline.trimEdge(value, 'c1', 'start', 0.5, 3);
  const all = timelineCaptions(trimmed, history, speakers);
  expect(all).toEqual([{ start: 0.5, end: 3, text: '第一句', speaker: '旁白' }, { start: 4, end: 7, text: '第二句\n\n换行', speaker: '小明' }]);
  // 所选范围与 WAV 一致：截到范围内，时间从范围起点算。
  expect(timelineCaptions(trimmed, history, speakers, { start: 2, end: 5 }).map(c => [c.start, c.end, c.text])).toEqual([[0, 1, '第一句'], [2, 3, '第二句\n\n换行']]);
  // 某位说话人只留他的片段；单条音轨导出时忽略静音，并转义 VTT 标记字符。
  expect(timelineCaptions(Timeline.scoped(trimmed, 'role:b', history), history, speakers).map(c => c.text)).toEqual(['第二句\n\n换行']);
  expect(timelineCaptions(Timeline.scoped(trimmed, 'track:t2', history), history, speakers).map(c => c.text)).toEqual(['<静音>']);
  expect(timelineCaptions(Timeline.scoped(trimmed, 'track:t3', history), history, speakers)).toEqual([]);
});

test('LRC 跳过段落标记，器乐间隔清屏，校准时间优先', () => {
  const lyrics = '[intro]\n\n[verse]\n第一句\n第二句\n\n[bridge]\n\n[chorus]\n第三句';
  const lines = lyricTimeline(lyrics, 60, [0, 10.5, 20, 30, 45]);
  expect(lyricsToLrc(lines, '我的歌')).toBe('[ti:我的歌]\n[00:10.50]第一句\n[00:20.00]第二句\n[00:30.00]\n[00:45.00]第三句\n');
  // 没有校准时按估算时间导出，第一行之前不写空行。
  const estimated = lyricsToLrc(lyricTimeline('[verse]\n第一句\n第二句', 30));
  expect(estimated.split('\n').filter(Boolean)).toHaveLength(2);
  expect(estimated).toMatch(/^\[\d{2}:\d{2}\.\d{2}\]第一句\n\[\d{2}:\d{2}\.\d{2}\]第二句\n$/);
  // 逐字 LRC：行内每个字前写开始时间，行尾写最后一个字的结束时间；没有逐字时间的行照常写整句。
  const words = [{ text: 'Hello ', start: 1, end: 1.4 }, { text: 'world', start: 1.5, end: 2 }];
  expect(lyricsToLrc([{ text: 'Hello world', start: 1, end: 3, words }, { text: '第二句', start: 3, end: 5 }], undefined, true))
    .toBe('[00:01.00]<00:01.00>Hello <00:01.50>world<00:02.00>\n[00:03.00]第二句\n');
});

async function storeAudio(page: Page, name: string, seconds: number, level = 0.25) {
  await page.evaluate(async ({ name, seconds, level }) => {
    const modulePath = '/src/shared/lib/sound.ts'; const { encodeWav } = await import(/* @vite-ignore */ modulePath);
    const audio = new AudioBuffer({ length: 24000 * seconds, sampleRate: 24000, numberOfChannels: 1 }); audio.getChannelData(0).fill(level);
    const blob = encodeWav(audio);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('voice-workbench-audio', 1); req.onupgradeneeded = () => req.result.createObjectStore('audio'); req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(blob, name); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  }, { name, seconds, level });
}

test('时间轴导出对话框按说话人导出 SRT 与带说话人的 VTT', async ({ page }, testInfo) => {
  const state = emptyState(); const draft = state.drafts[0];
  draft.kind = 'story'; draft.text = '第一句\n第二句';
  draft.subtitles = { speakers, cues: [{ id: 'cue-g1', speakerId: 'a', start: 0, end: 3000, text: '第一句' }, { id: 'cue-g2', speakerId: 'b', start: 3000, end: 6000, text: '第二句' }] };
  state.history = [segment('1'.repeat(32), '第一句', 'a', draft), segment('2'.repeat(32), '第二句', 'b', draft)];
  draft.timeline = { acceptedGenerations: state.history.map(g => g.id), tracks: [{ id: 'track', name: '对白', muted: false, clips: [
    { id: 'c1', generationId: '1'.repeat(32), start: 0, offset: 0, duration: 3 },
    { id: 'c2', generationId: '2'.repeat(32), start: 5, offset: 1, duration: 1.5 },
  ] }] };
  await page.goto('/');
  await storeAudio(page, 'segments.wav', 3);
  await seedState(page, state); await page.reload();
  await expect(page.locator('.multitrack-clip')).toHaveCount(2);
  const { readFile } = await import('node:fs/promises');
  async function exportCaptions(format: string, scope: string | null, speaker: boolean, file: string) {
    await page.getByRole('button', { name: '导出音轨', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: '格式', exact: true }).click();
    await page.getByRole('option', { name: format, exact: true }).click();
    if (scope) {
      await dialog.getByRole('combobox', { name: '导出范围', exact: true }).click();
      await page.getByRole('option', { name: scope, exact: true }).click();
    }
    if (speaker) await dialog.getByLabel('字幕包含说话人').check();
    await page.screenshot({ path: testInfo.outputPath(`${file}-dialog.png`) });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出字幕', exact: true }).click();
    const saved = await download; expect(saved.suggestedFilename()).toBe(file);
    await saved.saveAs(testInfo.outputPath(file));
    await expect(dialog).toHaveCount(0);
    return readFile(testInfo.outputPath(file), 'utf8');
  }
  expect(await exportCaptions('SRT 字幕', '小明', false, `${draft.title}.srt`)).toBe('1\n00:00:05,000 --> 00:00:06,500\n第二句\n');
  expect(await exportCaptions('WebVTT 字幕', '全部音轨', true, `${draft.title}.vtt`)).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n<v 旁白>第一句\n\n00:00:05.000 --> 00:00:06.500\n<v 小明>第二句\n');
});

test('导出音轨可统一各角色音量：只改导出的文件，选择会记住', async ({ page }, testInfo) => {
  const state = emptyState(); const draft = state.drafts[0];
  draft.kind = 'story'; draft.text = '第一句\n第二句';
  draft.subtitles = { speakers, cues: [{ id: 'cue-g1', speakerId: 'a', start: 0, end: 1000, text: '第一句' }, { id: 'cue-g2', speakerId: 'b', start: 1000, end: 2000, text: '第二句' }] };
  state.history = [{ ...segment('1'.repeat(32), '第一句', 'a', draft), fileName: 'loud.wav', duration: 1 }, { ...segment('2'.repeat(32), '第二句', 'b', draft), fileName: 'quiet.wav', duration: 1 }];
  draft.timeline = { acceptedGenerations: state.history.map(g => g.id), tracks: [{ id: 'track', name: '对白', muted: false, clips: [
    { id: 'c1', generationId: '1'.repeat(32), start: 0, offset: 0, duration: 1 },
    { id: 'c2', generationId: '2'.repeat(32), start: 1, offset: 0, duration: 1 },
  ] }] };
  await page.goto('/');
  await storeAudio(page, 'loud.wav', 1, 0.5); await storeAudio(page, 'quiet.wav', 1, 0.05);
  await seedState(page, state); await page.reload();
  await expect(page.locator('.multitrack-clip')).toHaveCount(2);
  const { readFile } = await import('node:fs/promises');
  // 前一秒是旁白、后一秒是小明，返回两段的平均电平（dBFS）。
  async function exportLevels(balance: boolean, file: string) {
    await page.getByRole('button', { name: '导出音轨', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const box = dialog.getByLabel('统一各角色音量');
    if (balance) await box.check(); else await box.uncheck();
    await page.screenshot({ path: testInfo.outputPath(`${file}.png`) });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出 WAV', exact: true }).click();
    await (await download).saveAs(testInfo.outputPath(file));
    await expect(dialog).toHaveCount(0);
    const wav = await readFile(testInfo.outputPath(file));
    const data = wav.indexOf('data') + 8, rate = wav.readUInt32LE(24), channels = wav.readUInt16LE(22);
    const level = (from: number) => { let sum = 0; for (let i = 0; i < rate / 2; i++) { const x = wav.readInt16LE(data + ((from + i) * channels) * 2) / 32768; sum += x * x; } return 10 * Math.log10(sum / (rate / 2)); };
    return [level(Math.floor(rate / 4)), level(rate + Math.floor(rate / 4))];
  }
  const [loud, quiet] = await exportLevels(false, 'plain.wav');
  expect(loud - quiet).toBeGreaterThan(15);
  const [a, b] = await exportLevels(true, 'balanced.wav');
  expect(Math.abs(a - b)).toBeLessThan(1);
  // 重新打开对话框时仍是勾选状态。
  await page.getByRole('button', { name: '导出音轨', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('统一各角色音量')).toBeChecked();
});

test('播放页导出 LRC 歌词使用校准时间', async ({ page }, testInfo) => {
  const draft = { ...createMusicDraft('zh-CN'), id: 'f'.repeat(32) };
  const state = emptyState();
  state.drafts = [draft];
  state.history = [{ id: 'song', title: draft.title, fileName: 'song.wav', createdAt: '2026-10-18T12:00:00Z', duration: 6, lyricTimes: [0, 1.25, 2.5, 4], settings: { ...draft, lyrics: '[intro]\n\n[verse]\n第一句\n第二句\n\n[chorus]\n第三句' } }];
  await page.goto('/');
  await storeAudio(page, 'song.wav', 6);
  await seedState(page, state); await page.reload();
  await page.locator('.player .transport').getByRole('button', { name: '播放页', exact: true }).click();
  const playing = page.getByRole('dialog', { name: `${draft.title} · 播放页` });
  await page.screenshot({ path: testInfo.outputPath('now-playing.png') });
  await playing.getByRole('button', { name: '歌词工具', exact: true }).click();
  await expect(page.getByRole('menu')).toContainText('歌词时间已校准');
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /^导出歌词（LRC）/ }).click();
  const saved = await download; expect(saved.suggestedFilename()).toBe(`${draft.title}.lrc`);
  await saved.saveAs(testInfo.outputPath('song.lrc'));
  const { readFile } = await import('node:fs/promises');
  expect(await readFile(testInfo.outputPath('song.lrc'), 'utf8')).toBe(`[ti:${draft.title}]\n[00:01.25]第一句\n[00:02.50]第二句\n[00:04.00]第三句\n`);
  // 逐字歌词：这段音频没有人声，逐字时间按音节在每行里均分。
  const wordDownload = page.waitForEvent('download');
  await playing.getByRole('button', { name: '歌词工具', exact: true }).click();
  await page.getByRole('menuitem', { name: /^导出逐字歌词/ }).click();
  await (await wordDownload).saveAs(testInfo.outputPath('song-words.lrc'));
  expect((await readFile(testInfo.outputPath('song-words.lrc'), 'utf8')).split('\n')[1]).toBe('[00:01.25]<00:01.25>第<00:01.56>一<00:01.88>句<00:02.19>');
});
