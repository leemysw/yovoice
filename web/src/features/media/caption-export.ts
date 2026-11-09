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
