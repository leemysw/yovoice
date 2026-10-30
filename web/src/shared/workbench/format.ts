// 把数据变成字符串的工具：稳定序列化、助手文本块拼接、时长与字节数的显示格式。
import type { AssistantBlock } from './types';

// 参数键的序列化顺序不影响试听是否过期。
export const stableJSON = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
/** 拼接内容块里的文本块，段与段之间空一行，与 Go 的 blocksText 一致。 */
export const blocksText = (blocks: AssistantBlock[]) => blocks.filter(block => block.kind === 'text' && block.text?.trim()).map(block => block.text!.trim()).join('\n\n');
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  if (i === 0) return `${Math.round(value)} B`;
  return `${value.toFixed(2)} ${units[i]}`;
}
