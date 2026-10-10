import { test, expect } from '@playwright/test';
import type { TranslatorFn } from '@astryxdesign/core/i18n';
import { SubtitleParser } from '../src/features/create/subtitle-parser';
import { Timeline } from '../src/features/media/timeline';
import { CallError, noticeMessage, parseCallError } from '../src/shared/lib/call-error';
import { formatCallError, formatNotice } from '../src/shared/i18n/format';
import { createDraft, previewStale, projectKind, requiresVoice, synthesisSettings, withCueIds, type Character, type Draft } from '../src/shared/workbench';

// 不打开页面，直接校验界面依赖的纯逻辑。

test('旧字幕补齐稳定标识，已有标识与无字幕作品保持原对象', () => {
  const draft: Draft = { ...createDraft(), id: 'd', subtitles: { speakers: [], cues: [{ start: 0, end: 1, text: 'a', speakerId: '1' }, { id: 'kept', start: 1, end: 2, text: 'b', speakerId: '1' }] } };
  const first = withCueIds(draft);
  expect(first.subtitles!.cues.map(c => c.id)).toEqual(['legacy-d-0', 'kept']);
  expect(withCueIds(draft).subtitles!.cues[0].id).toBe(first.subtitles!.cues[0].id);
  expect(withCueIds(first)).toBe(first);
  const plain = createDraft();
  expect(withCueIds(plain)).toBe(plain);
});

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
