import type { LogEntry, LogFilter, LogLevel, LogPage } from '../workbench';
import { CallError } from './call-error';

// 浏览器预览的日志：只在内存里保留本次打开后的关键操作，演示日志页；规则与 Go 服务的 diag 一致。
const entries: LogEntry[] = [];
const capacity = 2000;
const rank: Record<string, number> = { INFO: 1, WARN: 2, ERROR: 3 };

// 与 internal/desktop/rpc.go 的 audited 对应：这些方法无论成败都留一条记录。
export const auditedMethods = new Set([
  'draft.delete', 'project.export', 'project.import', 'score.import', 'score.export', 'character.save', 'character.delete',
  'voice.fromGeneration', 'voice.update', 'voice.record', 'timeline.import', 'media.rename', 'media.delete',
  'generation.lyricTimes', 'generation.lyricWords', 'generation.alignLyrics', 'preferences.save', 'storage.relocate', 'storage.cleanup', 'model.directory', 'model.download',
  'model.forget', 'runtime.install', 'ai.provider.save', 'ai.provider.delete', 'ai.provider.use', 'ai.test', 'ai.connect', 'ai.codex.login',
  'melody.plan', 'melody.cover', 'melody.dismiss', 'ai.dismiss', 'operation.cancel', 'model.cancel', 'ai.cancel', 'logs.export', 'assets.delete',
  'assistant.proposal', 'assistant.forget',
]);

export function logLevel(event: string, fields: Record<string, unknown> = {}): LogLevel {
  if (fields.error != null || /(_failed|_rejected|_denied|\.failed|\.corrupt|\.error|\.crashed)$/.test(event)) return 'ERROR';
  if (/(_skipped|\.slow|_invalid|_killed|\.exited|\.warning|_timeout)$/.test(event)) return 'WARN';
  return 'INFO';
}

export function previewLog(event: string, fields: Record<string, unknown> = {}) {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== ''));
  entries.push({ time: new Date().toISOString(), level: logLevel(event, clean), event, ...(Object.keys(clean).length ? { fields: clean } : {}) });
  if (entries.length > capacity) entries.splice(0, entries.length - capacity);
}

// 调用失败时与 Go 的 msg.Encode 一样记下消息码和参数。
export const encodeError = (error: unknown) => error instanceof CallError
  ? { code: error.code, ...(Object.keys(error.params).length ? { params: error.params } : {}) }
  : { code: '@yovoice.error.unknown', params: { detail: error instanceof Error ? error.message : String(error) } };

export const moduleOf = (event: string) => event.split('.')[0];

export function previewQueryLogs(filter: LogFilter): LogPage {
  const minimum = rank[(filter.level ?? '').toUpperCase()] ?? 0, text = filter.text?.trim().toLowerCase() ?? '';
  const since = filter.since ? Date.parse(filter.since) : 0;
  const matched = entries.filter(entry => rank[entry.level] >= minimum && (!filter.module || moduleOf(entry.event) === filter.module)
    && (!since || Date.parse(entry.time) >= since) && (!text || JSON.stringify(entry).toLowerCase().includes(text))).reverse();
  const offset = Math.max(0, filter.offset ?? 0), limit = Math.min(500, filter.limit || 500);
  return { entries: matched.slice(offset, offset + limit), total: matched.length, modules: [...new Set(entries.map(entry => moduleOf(entry.event)))].sort() };
}

// 预览没有诊断包，直接下载本次记录的 JSON Lines。
export function previewExportLogs(): string {
  return entries.map(({ time, level, event, fields }) => JSON.stringify({ time, level, msg: event, ...fields })).join('\n') + (entries.length ? '\n' : '');
}
