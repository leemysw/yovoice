import type { AudioTimeline, Generation, SubtitleSpeaker } from '../../shared/workbench';
import { Timeline } from './timeline';

// 按时间轴上片段的实际播放区间导出字幕，与导出的 WAV 对齐；不使用原字幕文件里的时间。
export interface Caption { start: number; end: number; text: string; speaker?: string }

// 字幕时间统一取整到毫秒，避免 59.9996 秒进位后出现 60 秒。
function clock(seconds: number, separator: string) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000, s = Math.floor(total / 1000) % 60, m = Math.floor(total / 60000) % 60, h = Math.floor(total / 3600000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(ms).padStart(3, '0')}`;
}
export const srtTime = (seconds: number) => clock(seconds, ',');
export const vttTime = (seconds: number) => clock(seconds, '.');

// 只取可听音轨里由台词生成的片段；上传的音频和整篇旧音频没有台词，不出字幕。
// range 与 WAV 导出一致：片段截到范围内，时间从范围起点算起。
export function timelineCaptions(value: AudioTimeline, history: Generation[], speakers: SubtitleSpeaker[] = [], range?: { start: number; end: number }): Caption[] {
  const from = range?.start ?? 0, to = range?.end ?? Infinity;
  const captions: Caption[] = [];
  for (const track of Timeline.audible(value)) for (const clip of track.clips) {
    const generation = history.find(g => g.id === clip.generationId);
    const text = generation?.segment ? generation.settings.text.trim() : '';
    const start = Math.max(from, clip.start), end = Math.min(to, clip.start + clip.duration);
    if (!text || end - start < 0.001) continue;
    const segment = generation!.segment!;
    const speaker = speakers.find(s => s.id === segment.speakerId)?.sourceName || segment.speakerName;
    captions.push({ start: start - from, end: end - from, text, ...(speaker ? { speaker } : {}) });
  }
  return captions.sort((a, b) => a.start - b.start || a.end - b.end);
}

// 台词里的空行会提前结束字幕块，合并为单个换行。
const cueText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n\s*\n+/g, '\n');
const vttEscape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function captionsToSrt(captions: Caption[], withSpeaker = false): string {
  return captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${withSpeaker && c.speaker ? `${c.speaker}: ` : ''}${cueText(c.text)}\n`).join('\n');
}

// WebVTT 用 <v 名字> 标出说话人，播放器可以按说话人设置样式。
export function captionsToVtt(captions: Caption[], withSpeaker = false): string {
  const cues = captions.map(c => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${withSpeaker && c.speaker ? `<v ${vttEscape(c.speaker).replace(/\s+/g, ' ')}>` : ''}${vttEscape(cueText(c.text))}\n`);
  return ['WEBVTT\n', ...cues].join('\n');
}

// 逐词时间转字幕行：对齐与识别给出的词不带标点，按顺序在原文里找到每个词的位置，字幕文字取原文（保留标点），
// 在句末标点、过长、过久或较长停顿处换行。中日韩文字一字算 1，其他字符算半个，每行最多 maxWidth。
export interface TimedWord { word: string; start: number; end: number }
const sentenceEnd = /[。！？!?；;…]|\.(\s|$)/;
const clauseEnd = /[，,、：:—]/;
const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const width = (text: string) => [...text].reduce((sum, c) => sum + (wide.test(c) ? 1 : c.trim() ? .5 : .25), 0);
// 行首去掉标点，行尾只保留问号、感叹号、省略号和引号括号。
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/^[\s，,、。.；;：:！!？?]+/, '').replace(/[\s，,、。；;：:]+$/, '').replace(/([^.\s])\.$/, '$1');

export function wordCaptions(text: string, words: TimedWord[], { maxWidth = 20, maxSeconds = 6, pause = 0.8 } = {}): Caption[] {
  const lower = text.toLocaleLowerCase();
  // 每个词在原文里的范围；找不到（识别或对齐改了写法）时沿用上一个词的结尾。
  let cursor = 0;
  const spans = words.map(w => {
    const at = w.word ? lower.indexOf(w.word.toLocaleLowerCase(), cursor) : -1;
    if (at < 0 || at - cursor > 40) return [cursor, cursor] as const;
    cursor = at + w.word.length;
    return [at, cursor] as const;
  });
  const located = spans.some(([a, b]) => b > a);
  const captions: Caption[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    const next = i + 1 < words.length ? i + 1 : -1;
    const between = next < 0 ? text.slice(spans[i][1]) : text.slice(spans[i][1], spans[next][0]);
    const lineText = (j: number) => located ? text.slice(spans[first][0], spans[j][1]) : words.slice(first, j + 1).map(w => w.word).join(wide.test(words[first].word) ? '' : ' ');
    const current = width(lineText(i));
    const breakHere = next < 0 || sentenceEnd.test(between) || between.includes('\n')
      || (clauseEnd.test(between) && current >= maxWidth * .4)
      || width(lineText(next)) > maxWidth || words[next].end - words[first].start > maxSeconds || words[next].start - words[i].end > pause;
    if (!breakHere) continue;
    // 行尾带上紧跟的标点（问号、引号等），整理后为空的行（只有标点）并入时间但不出字幕。
    const tail = located ? between.match(/^[^\p{L}\p{N}\n]*/u)?.[0] ?? '' : '';
    const caption = tidy(lineText(i) + tail);
    if (caption) captions.push({ start: words[first].start, end: Math.max(words[i].end, words[first].start + .2), text: caption });
    first = i + 1;
  }
  // 相邻两行不重叠。
  for (let i = 0; i + 1 < captions.length; i++) captions[i].end = Math.min(captions[i].end, captions[i + 1].start);
  return captions;
}

// 语音版本实际念出的正文：去掉给模型的方括号标记（如 [laugh]），与后端对齐时用的文字一致。
export const spokenText = (text: string) => text.replace(/\[[^[\]\n]{1,40}\]/g, '').trim();
