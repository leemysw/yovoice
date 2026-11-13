import { test, expect } from '@playwright/test';
import type { TranslatorFn } from '@astryxdesign/core/i18n';
import { SubtitleParser } from '../src/features/create/subtitle-parser';
import { Timeline } from '../src/features/media/timeline';
import { CallError, noticeMessage, parseCallError } from '../src/shared/lib/call-error';
import { formatCallError, formatNotice } from '../src/shared/i18n/format';
import { alignedTimeline, alignLyrics, vocalActivity, withWords } from '../src/features/music/lyric-align';
import { activeLyric, estimateWords, lyricRows, lyricTimeline, lyricTokens } from '../src/features/music/lyric-timing';
import { songLyrics, syntheticSong } from './synthetic-song';
import { readFileSync } from 'node:fs';
import { isUiLocale, resolveInitialUiLocale, uiLocales } from '../src/shared/i18n/locale';
import { createDraft, previewStale, projectKind, requiresVoice, synthesisSettings, formatBytes, type Character, type Draft } from '../src/shared/workbench';

// 不打开页面，直接校验界面依赖的纯逻辑。

test('试听过期只看文本与参数取值，忽略键顺序和与 Go 默认值相同的缺省字段', () => {
  const settings = synthesisSettings(createDraft());
  const character = (current: object, preview: object, text = '示例'): Character => ({ id: 'c', name: '角色', demoText: '示例', settings: { ...settings, ...current }, preview: { id: 'p', fileName: 'p.wav', duration: 1, text, settings: { ...settings, ...preview } } });
  expect(previewStale({ id: 'c', name: '角色', demoText: '', settings })).toBe(false);
  expect(previewStale(character({}, {}))).toBe(false);
  expect(previewStale(character({ modelOptions: { a: { x: 1, y: 2 } } }, { modelOptions: { a: { y: 2, x: 1 } } }))).toBe(false);
  expect(previewStale(character({ speaker: '', modelOptions: {} }, { speaker: undefined }))).toBe(false);
  // 固定种子 0 与自动随机种子不同。
  expect(previewStale(character({ seed: 0 }, { seed: null }))).toBe(true);
  expect(previewStale(character({ speed: 1.2 }, {}))).toBe(true);
  expect(previewStale(character({}, {}, '旧文本'))).toBe(true);
});

test('参考音频需求随模型和模式变化', () => {
  const needs = (modelId: string, extra: Partial<Draft> = {}) => requiresVoice({ ...createDraft(), modelId, ...extra });
  expect(needs('index-2.5-q8')).toBe(true);
  expect(needs('kokoro-82m')).toBe(false);
  expect(needs('qwen3-tts-0.6b-base')).toBe(true);
  expect(needs('qwen3-tts-1.7b-customvoice')).toBe(false);
  expect(needs('qwen3-tts-1.7b-voicedesign')).toBe(false);
  expect(needs('omnivoice-q8')).toBe(false);
  expect(needs('omnivoice-q8', { voiceMode: 'clone' })).toBe(true);
  expect(needs('breeze-tts-2-q8')).toBe(false);
  expect(needs('breeze-tts-2-q8', { voiceMode: 'clone' })).toBe(true);
  expect(needs('ming3-tts-0.5b-q8')).toBe(false);
  expect(needs('ming3-tts-0.5b-q8', { voiceMode: 'clone' })).toBe(true);
  expect(needs('voxtral-tts-4b-q8')).toBe(false);
  expect(needs('plapre-3-bf16')).toBe(false);
  expect(needs('plapre-3-bf16', { voiceMode: 'clone' })).toBe(true);
  expect(needs('xtts-v2-q8')).toBe(true);
  expect(needs('gradium-phonon-31m-en-q8')).toBe(false);
  expect(needs('fish-drama3-small-iq3')).toBe(false);
  expect(needs('fish-drama3-small-iq3', { voiceMode: 'clone' })).toBe(true);
  expect(needs('voxcpm2-q8')).toBe(false);
  expect(needs('voxcpm2-q8', { voxMode: 'clone' })).toBe(true);
  expect(needs('voxcpm2-q8', { voxMode: 'continuation' })).toBe(true);
});

test('作品类型兼容旧字幕，合成参数快照不含作品字段且与原作品隔离', () => {
  const draft = createDraft();
  expect(projectKind(draft)).toBe('text');
  expect(projectKind({ ...draft, kind: 'subtitle' })).toBe('story');
  expect(projectKind({ ...draft, subtitles: { speakers: [], cues: [] } })).toBe('story');
  const settings = synthesisSettings({ ...draft, title: '标题', text: '正文', timeline: { tracks: [] } });
  for (const key of ['id', 'title', 'text', 'timeline', 'subtitles', 'kind']) expect(settings).not.toHaveProperty(key);
  settings.emotions[0] = 1;
  expect(draft.emotions[0]).toBe(0);
});

test('错误码与底层原因在保存为提示文本后仍可翻译并保留原因', () => {
  const t = ((code: string) => `[${code}]`) as unknown as TranslatorFn;
  expect(parseCallError({ code: '@yovoice.request.invalid', params: { field: 'id' } })).toMatchObject({ code: '@yovoice.request.invalid', params: { field: 'id' } });
  expect(parseCallError('@yovoice.request.invalid').code).toBe('@yovoice.request.invalid');
  const hostFailure = parseCallError('文件被占用。');
  expect(hostFailure).toMatchObject({ code: '@yovoice.error.unknown', params: { detail: '文件被占用。' } });
  expect(parseCallError({ other: 1 }).params.detail).toBe('{"other":1}');
  expect(parseCallError(null).params).toEqual({});

  const notice = noticeMessage(hostFailure);
  expect(notice).toBe('@yovoice.error.unknown::文件被占用。');
  // 原因本身含有分隔符时只按第一个分隔符拆分。
  expect(formatNotice(t, '@yovoice.error.unknown::a::b')).toBe('[@yovoice.error.unknown] (a::b)');
  expect(formatNotice(t, notice)).toBe('[@yovoice.error.unknown] (文件被占用。)');
  expect(formatNotice(t, noticeMessage(new CallError('@yovoice.request.invalid')))).toBe('[@yovoice.request.invalid]');
  expect(formatNotice(t, noticeMessage(new Error('普通错误')))).toBe('普通错误');
  expect(formatCallError(t, hostFailure)).toBe('[@yovoice.error.unknown] (文件被占用。)');
  expect(formatCallError(t, new Error('崩溃'))).toBe('[@yovoice.error.unknown] (崩溃)');
});

test('独听优先于普通轨，静音轨不参与播放；素材与生成音频的源标识不冲突', () => {
  const lane = (id: string, extra = {}) => ({ id, name: id, muted: false, clips: [], ...extra });
  expect(Timeline.audible({ tracks: [lane('a'), lane('b', { muted: true })] }).map(t => t.id)).toEqual(['a']);
  expect(Timeline.audible({ tracks: [lane('a'), lane('b', { solo: true }), lane('c', { solo: true, muted: true })] }).map(t => t.id)).toEqual(['b']);
  const clip = { id: 'c', start: 0, offset: 0, duration: 1 };
  expect(Timeline.sourceKey({ ...clip, generationId: 'x' })).toBe('x');
  expect(Timeline.sourceKey({ ...clip, assetId: 'x', generationId: 'x' })).toBe('asset:x');
  expect(Timeline.sourceKey(clip)).toBe('');
});

test('字幕拒绝未知格式与缺少列定义的 ASS，按开始时间排序并解码数字实体', () => {
  const parser = new SubtitleParser();
  expect(() => parser.parse('test.txt', '1\n00:00:01,000 --> 00:00:02,000\nHi')).toThrow('@yovoice.subtitle.invalid');
  expect(() => parser.parse('test.ass', '[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi')).toThrow('@yovoice.subtitle.invalid');
  const parsed = parser.parse('test.srt', '2\n00:00:05,000 --> 00:00:06,000\n后&#x4E00;句\n\n1\n00:00:01,000 --> 00:00:02,000\n&#65;&unknown;');
  expect(parsed.cues.map(c => c.text)).toEqual(['A&unknown;', '后一句']);
  // 未标注人名的台词归入同一个匿名说话人。
  expect(parsed.speakers).toEqual([{ id: '1', sourceName: '' }]);
  expect(new Set(parsed.cues.map(c => c.id)).size).toBe(2);
});

test('存储容量格式化正确支持字节单位换算', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(-100)).toBe('0 B');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(1024)).toBe('1.00 KB');
  expect(formatBytes(1024 * 1024 * 5)).toBe('5.00 MB');
  expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB');
});

test('播放页歌词时间：按音节分配整首时长，空段落是器乐间隔，并补前奏', () => {
  const lines = lyricTimeline('[intro]\n\n[verse]\n一二三四五六\nhello world\n\n[chorus]\n七八九', 100);
  expect(lines.map(line => line.instrumental ? '…' : line.text)).toEqual(['…', '一二三四五六', 'hello world', '七八九']);
  expect(lines[0].start).toBe(0);
  expect(lines.at(-1)!.end).toBeCloseTo(100);
  // 时间连续、单调递增，字多的句子更长。
  lines.slice(1).forEach((line, i) => expect(line.start).toBeCloseTo(lines[i].end));
  expect(lines[1].end - lines[1].start).toBeGreaterThan(lines[2].end - lines[2].start);
  expect(activeLyric(lines, 0)).toBe(0);
  expect(activeLyric(lines, lines[2].start + 0.01)).toBe(2);
  expect(activeLyric(lines, 1000)).toBe(3);
  // 开头直接是歌词时补一段前奏；没有歌词或时长未知时不显示歌词。
  expect(lyricTimeline('第一句', 10)[0].instrumental).toBe(true);
  expect(lyricTimeline('[instrumental]', 10)).toEqual([]);
  expect(lyricTimeline('第一句', 0)).toEqual([]);
  // 校准过的时间按行使用：第一句前补前奏，每行持续到下一行开始；行数对不上时退回估算。
  const lyrics = '[verse]\n第一句\n第二句';
  expect(lyricRows(lyrics)).toEqual([{ text: '第一句' }, { text: '第二句' }]);
  expect(lyricTimeline(lyrics, 20, [4, 9])).toEqual([{ text: '', start: 0, end: 4, instrumental: true }, { text: '第一句', start: 4, end: 9 }, { text: '第二句', start: 9, end: 20 }]);
  expect(lyricTimeline(lyrics, 20, [4]).map(line => line.start)).not.toContain(4);
});

test('歌词按音频自动定位：人声片段的开头对上每一行，没有人声时退回估算', () => {
  const song = syntheticSong(songLyrics, .3);
  const times = alignLyrics(song.rows, vocalActivity(song.left, song.right, song.rate), song.duration);
  expect(times).not.toBeNull();
  // 每行开始时间非递减；演唱行误差多在 0.3 秒内，被乐器起音带偏的也不超过 0.6 秒（按时长估算时差 3～5 秒）。
  const errors = (result: number[] | null) => song.rows.flatMap((row, index) => row.instrumental ? [] : [Math.abs(result![index] - song.starts[index])]).sort((a, b) => a - b);
  times!.forEach((time, index) => { if (index) expect(time).toBeGreaterThanOrEqual(times![index - 1]); });
  expect(errors(times).at(-1)).toBeLessThan(.6);
  expect(errors(times)[3]).toBeLessThan(.3);
  // 单声道也能靠能量起伏定位。
  const mono = song.left.map((value, i) => (value + song.right[i]) / 2);
  const monoTimes = alignLyrics(song.rows, vocalActivity(mono, mono, song.rate), song.duration);
  expect(errors(monoTimes).at(-1)).toBeLessThan(.6);
  // 只有伴奏、或者全是静音时判断不可靠，返回 null。
  const accompaniment = syntheticSong(songLyrics, 0);
  expect(alignLyrics(accompaniment.rows, vocalActivity(accompaniment.left, accompaniment.right, accompaniment.rate), accompaniment.duration)).toBeNull();
  const silence = new Float32Array(16000 * 20);
  expect(alignLyrics(song.rows, vocalActivity(silence, silence, 16000), 20)).toBeNull();
});

test('逐字时间：中文逐字、英文逐词拆分，按人声片段分配，行内停顿不占字', () => {
  expect(lyricTokens('“你好，world!” 再见').map(token => token.text)).toEqual(['“你', '好，', 'world!” ', '再', '见']);
  expect(lyricTokens('hello beautiful').map(token => token.weight)).toEqual([2, 3]);
  // 没有音频时按音节均分，唱完后留出换气，不把最后一个字拖到下一句。
  const estimated = estimateWords({ text: '一二三四', start: 10, end: 20 });
  expect(estimated.map(word => word.start)).toEqual([10, 11.875, 13.75, 15.625]);
  expect(estimated.at(-1)!.end).toBe(17.5);
  // 合成歌曲已知每个字的开始时间：按真实的行开始时间逐字对齐，多数字误差在 0.1 秒内，最大不超过 0.3 秒。
  const song = syntheticSong(songLyrics, .3);
  const lines = withWords(lyricTimeline(songLyrics, song.duration, song.starts), vocalActivity(song.left, song.right, song.rate));
  const sung = song.words.filter(words => words.length);
  const errors = lines.filter(line => line.words).flatMap((line, index) => line.words!.map((word, k) => Math.abs(word.start - sung[index][k]))).sort((a, b) => a - b);
  expect(errors).toHaveLength(sung.flat().length);
  expect(errors[errors.length >> 1]).toBeLessThan(.1);
  expect(errors.at(-1)).toBeLessThan(.3);
  for (const line of lines) line.words?.forEach((word, k) => { expect(word.end).toBeGreaterThan(word.start); if (k) expect(word.start).toBeGreaterThanOrEqual(line.words![k - 1].end); });
});

test('对齐模型的逐字结果放回歌词行：词被拆开或合并都能对上，歌词改过时不用；长歌交给后端按行分组', () => {
  // 合成歌曲已知每个字的时间，模拟对齐模型逐字返回（不带标点）。
  const song = syntheticSong(songLyrics, .3), rows = lyricRows(songLyrics);
  const aligned = rows.flatMap((row, index) => [...row.text].map((word, k) => ({ word, start: song.words[index][k], end: song.words[index][k] + .2 })));
  const lines = alignedTimeline(rows, aligned, song.duration)!;
  const sung = lines.filter(line => !line.instrumental);
  expect(sung.map(line => line.text)).toEqual(rows.filter(row => !row.instrumental).map(row => row.text));
  expect(sung.flatMap(line => line.words!.map(word => word.start))).toEqual(song.words.flat());
  // 行从第一个字开始，一直显示到下一行开始；开头补前奏。
  expect(lines[0].instrumental).toBe(true);
  for (let i = 1; i < lines.length; i++) expect(lines[i].start).toBeGreaterThanOrEqual(lines[i - 1].start);
  // 英文词被拆成两段、中文两个字合成一个词：词的时间按字数平分到每个字，再落到对应的单元上。
  const mixed = alignedTimeline(lyricRows('Beautiful, 你好'), [{ word: 'beau', start: 1, end: 1.4 }, { word: 'tiful', start: 1.4, end: 2 }, { word: '你好', start: 3, end: 4 }], 10)!;
  expect(mixed.at(-1)!.words).toEqual([{ text: 'Beautiful, ', start: 1, end: 2 }, { text: '你', start: 3, end: 3.5 }, { text: '好', start: 3.5, end: 4 }]);
  expect(alignedTimeline(lyricRows('完全不同的一句歌词'), [{ word: '别的', start: 1, end: 2 }], 10)).toBeNull();
  // 日文、韩文按词给时间时，词里的每个字仍各有先后；对齐模型丢掉的符号不计数，全角标点不影响对应。
  const korean = alignedTimeline(lyricRows('사랑해，さくら'), [{ word: '사랑해', start: 0, end: 3 }, { word: 'さくら', start: 4, end: 7 }], 10)!;
  expect(korean[0].words!.map(word => [word.start, word.end])).toEqual([[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7]]);
});

test('首次启动按系统语言选择界面语言，繁体与葡语按地区归并，未知语言回退英文', () => {
  expect(['zh-CN', 'zh', 'zh-Hans-CN', 'zh-SG'].map(resolveInitialUiLocale)).toEqual(['zh-CN', 'zh-CN', 'zh-CN', 'zh-CN']);
  expect(['zh-TW', 'zh-HK', 'zh-Hant', 'zh_Hant_MO'].map(resolveInitialUiLocale)).toEqual(['zh-TW', 'zh-TW', 'zh-TW', 'zh-TW']);
  expect(['ja-JP', 'ko', 'pt-PT', 'pt-BR', 'de-AT', 'en-GB', 'ar-SA', 'tr'].map(resolveInitialUiLocale)).toEqual(['ja', 'ko', 'pt-BR', 'pt-BR', 'de', 'en', 'en', 'en']);
  expect(isUiLocale('vi')).toBe(true);
  expect(isUiLocale('pt')).toBe(false);
});

test('各语言目录与英文目录键一致，占位符相同', () => {
  const read = (id: string) => JSON.parse(readFileSync(`src/shared/i18n/catalogs/${id.toLowerCase()}.json`, 'utf8')) as Record<string, { defaultMessage: string }>;
  const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  const en = read('en');
  for (const { id } of uiLocales) {
    const catalog = read(id);
    expect(Object.keys(catalog).sort(), id).toEqual(Object.keys(en).sort());
    // 先收集占位符不一致的键再一次断言，几千条逐个 expect 很慢。
    const mismatched = Object.entries(en).filter(([key, { defaultMessage }]) => params(catalog[key].defaultMessage) !== params(defaultMessage)).map(([key]) => key);
    expect(mismatched, id).toEqual([]);
  }
});
