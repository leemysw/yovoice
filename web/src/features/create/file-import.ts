import { CallError } from '../../shared/lib/call-error';
import { fileExtension } from '../../shared/lib/file-name';
import type { SubtitleDocument } from '../../shared/workbench';
import { SubtitleParser } from './subtitle-parser';

// 导入配音的文件：纯文本与 Markdown 成为语音作品，字幕成为故事作品。
export const subtitleAccept = '.srt,.vtt,.ass,.ssa';
export const importAccept = `.txt,.md,.markdown,${subtitleAccept}`;
// 与后端正文上限一致，按 UTF-16 计数。
export const maxTextLength = 12000;

export type ImportedFile = { title: string } & ({ kind: 'text'; text: string } | { kind: 'story'; subtitles: SubtitleDocument });

export const fileTitle = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 120);

/** 读取文本文件：按 BOM 识别 UTF-16，否则按 UTF-8，失败时回退 GB18030（Windows 记事本常见的中文编码）。 */
export async function readTextFile(file: Blob, invalid: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
  if (file.size > maxBytes) throw new CallError(invalid as `@yovoice.${string}`);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const encodings = bytes[0] === 0xff && bytes[1] === 0xfe ? ['utf-16le'] : bytes[0] === 0xfe && bytes[1] === 0xff ? ['utf-16be'] : ['utf-8', 'gb18030'];
  for (const encoding of encodings) {
    try { return new TextDecoder(encoding, { fatal: true }).decode(buffer); }
    catch { /* 换下一种编码。 */ }
  }
  throw new CallError('@yovoice.subtitle.encoding');
}

/** 去掉 Markdown 的标记符号，只保留需要朗读的文字。 */
export function markdownText(source: string): string {
  return source
    .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '');
}

/** 整理正文：统一换行，去掉行尾空白，多个空行合并为一个。 */
function tidy(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function readImport(file: File): Promise<ImportedFile> {
  const title = fileTitle(file.name);
  const type = fileExtension(file.name);
  if (subtitleAccept.split(',').includes(`.${type}`)) {
    return { kind: 'story', title, subtitles: new SubtitleParser().parse(file.name, await readTextFile(file, '@yovoice.subtitle.invalid')) };
  }
  if (!['txt', 'md', 'markdown'].includes(type)) throw new CallError('@yovoice.import.unsupported');
  const raw = await readTextFile(file, '@yovoice.import.tooLarge');
  const text = tidy(type === 'txt' ? raw : markdownText(raw));
  if (!text) throw new CallError('@yovoice.import.empty');
  if (text.length > maxTextLength) throw new CallError('@yovoice.import.tooLong');
  return { kind: 'text', title, text };
}
