import { alignedTimeline } from '../music/lyric-align';
import { lyricRows, lyricTimeline } from '../music/lyric-timing';
import type { Generation } from '../../shared/workbench';

// 随歌曲分享的一行歌词：开始、结束秒数；用对齐模型对过的还有每个字的时间。社区页按它滚动显示。
export interface SharedLyricLine { start: number; end: number; text: string; words?: { text: string; start: number; end: number }[] }

// none：没有歌词（纯音乐或没写词）；unaligned：有歌词但还没对齐，不随歌曲分享；aligned：lines 就是要分享的歌词。
export type SharedLyrics = { state: 'none' } | { state: 'unaligned' } | { state: 'aligned'; lines: SharedLyricLine[] };

const round = (seconds: number) => Math.round(seconds * 100) / 100;

// 只认用户自己对齐过的时间：逐字对齐的结果，或播放页逐行校准的结果。自动定位和估算的时间不够准，不拿去分享。
export function sharedLyrics(generation: Generation): SharedLyrics {
  const lyrics = generation.settings.instrumental ? '' : generation.settings.lyrics ?? '';
  const rows = lyricRows(lyrics);
  if (!rows.some(row => !row.instrumental && row.text.trim())) return { state: 'none' };
  const duration = generation.duration;
  const timeline = generation.lyricWords?.length
    ? alignedTimeline(rows, generation.lyricWords, duration)
    : generation.lyricTimes?.length === rows.length ? lyricTimeline(lyrics, duration, generation.lyricTimes) : null;
  if (!timeline) return { state: 'unaligned' };
  const lines = timeline.filter(line => !line.instrumental && line.text.trim()).map(line => {
    const start = round(Math.min(duration, line.start));
    const words = line.words?.filter(word => word.text.trim()).map(word => ({ text: word.text, start: round(Math.min(duration, word.start)), end: round(Math.min(duration, Math.max(word.start, word.end))) }));
    return { start, end: round(Math.min(duration, Math.max(line.start, line.end))), text: line.text.trim(), ...(words?.length ? { words } : {}) };
  });
  return lines.length ? { state: 'aligned', lines } : { state: 'unaligned' };
}
