import type { AlignedWord, TranscriptCaption } from '../../shared/workbench';

// 字幕编辑：合并、拆分、删除与查找替换都返回新数组，不改动传入的字幕，便于撤销。

// 中日韩文字与全角标点之间不加空格，其他文字用空格隔开；与后端拼接分段识别结果的规则一致。
const close = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

export function joinText(a: string, b: string): string {
  a = a.trim(); b = b.trim();
  if (!a || !b) return a + b;
  return close.test(a.at(-1)!) || close.test(b[0]) ? a + b : `${a} ${b}`;
}

// 把第 index 行与下一行合并：时间取两行的首尾，文字相连。
export function mergeNext(captions: TranscriptCaption[], index: number): TranscriptCaption[] {
  const a = captions[index], b = captions[index + 1];
  if (!a || !b) return captions;
  return [...captions.slice(0, index), { start: a.start, end: Math.max(a.end, b.end), text: joinText(a.text, b.text) }, ...captions.slice(index + 2)];
}

// 在第 index 行文字的 at 位置拆成两行。切开的时间优先取逐词时间：落在这一行里的词按顺序在文字中定位，
// 光标前最后一个词的结尾是前一行的结束，之后第一个词的开头是后一行的开始；定位不到时按字数比例估算。
// 光标在行首或行尾（拆出空行）时返回 null。
export function splitAt(captions: TranscriptCaption[], index: number, at: number, words: AlignedWord[]): TranscriptCaption[] | null {
  const c = captions[index];
  if (!c) return null;
  const before = c.text.slice(0, at).trim(), after = c.text.slice(at).trim();
  if (!before || !after) return null;
  let end = c.start + (c.end - c.start) * at / c.text.length, start = end;
  const lower = c.text.toLocaleLowerCase();
  let cursor = 0, last: AlignedWord | undefined, next: AlignedWord | undefined;
  for (const w of words) {
    if (w.start < c.start - .01 || w.end > c.end + .01 || !w.word) continue;
    const found = lower.indexOf(w.word.toLocaleLowerCase(), cursor);
    if (found < 0) continue;
    cursor = found + w.word.length;
    if (cursor <= at) last = w;
    else if (found >= at) { next = w; break; }
  }
  if (last && next) { end = last.end; start = next.start; }
  // 时间保持在本行之内且前后不交叠。
  end = Math.min(Math.max(end, c.start), c.end); start = Math.min(Math.max(start, end), c.end);
  return [...captions.slice(0, index), { start: c.start, end: round(end), text: before }, { start: round(start), end: c.end, text: after }, ...captions.slice(index + 1)];
}

export const removeAt = (captions: TranscriptCaption[], index: number) => captions.filter((_, i) => i !== index);

export const editText = (captions: TranscriptCaption[], index: number, text: string) => captions.map((c, i) => i === index ? { ...c, text } : c);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = (find: string, matchCase: boolean) => new RegExp(escape(find), matchCase ? 'g' : 'gi');

// 含有查找内容的行号；查找内容为空时为空列表。
export function findRows(captions: TranscriptCaption[], find: string, matchCase = false): number[] {
  if (!find) return [];
  const re = pattern(find, matchCase);
  return captions.flatMap((c, i) => c.text.search(re) >= 0 ? [i] : []);
}

// 每一处匹配的行号与在这一行里的起止位置，按出现顺序排列；查找下一个、上一个据此跳转。
export function findHits(captions: TranscriptCaption[], find: string, matchCase = false): { index: number; start: number; end: number }[] {
  if (!find) return [];
  const re = pattern(find, matchCase);
  return captions.flatMap((c, index) => Array.from(c.text.matchAll(re), m => ({ index, start: m.index, end: m.index + m[0].length })));
}

// 把所有行里的查找内容换成 replacement，返回新字幕与替换的处数；rows 给出时只替换这些行。
export function replaceAll(captions: TranscriptCaption[], find: string, replacement: string, matchCase = false, rows?: number[]): { captions: TranscriptCaption[]; count: number } {
  if (!find) return { captions, count: 0 };
  let count = 0;
  const only = rows ? new Set(rows) : undefined;
  const next = captions.map((c, i) => {
    if (only && !only.has(i)) return c;
    const text = c.text.replace(pattern(find, matchCase), () => { count++; return replacement; });
    return text === c.text ? c : { ...c, text };
  });
  return { captions: count ? next : captions, count };
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
