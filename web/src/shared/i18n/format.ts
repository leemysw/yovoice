import type { TranslatorFn } from '@astryxdesign/core/i18n';
import type { Activity, MelodyIssue, MessageCode, MessageParams } from '../workbench';
import { CallError } from '../lib/call-error';

const unknownCode = '@yovoice.error.unknown' as MessageCode;

// 界面里日期时间的几种固定写法：full 年月日时分（资源页、作品创建时间），day 月日时分（更新检查时间），
// log 月日时分秒（日志、版本记录），brief 短月份加日期与时分（时间线和播放器里挑版本）。
const dateStyles = {
  full: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  day: { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  log: { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
  brief: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/** 按界面语言格式化日期时间；locale 为空时用浏览器默认语言。 */
export const formatDateTime = (value: string | number | Date, locale: string | undefined, style: keyof typeof dateStyles = 'full') =>
  new Date(value).toLocaleString(locale, dateStyles[style]);

/** Translate activity.code; missing keys fall back to unknown (never paint Chinese). */
export function formatActivity(t: TranslatorFn, activity: Activity | null | undefined): string {
  if (!activity?.code) return t(unknownCode);
  return t(activity.code, activity.params ?? undefined);
}

/** 旋律谱问题：按问题类型给出原因，附上所在小节与声部（Vocal 人声、Ins 伴奏），没有小节时给出行号。 */
export function formatMelodyIssue(t: TranslatorFn, issue: MelodyIssue): string {
  const voice = issue.voice === 'Vocal' || issue.voice === 'Ins' ? t(`@yovoice.melody.voice.${issue.voice}`) : '';
  const where = issue.bar ? t(voice ? '@yovoice.melody.where.barVoice' : '@yovoice.melody.where.bar', { bar: issue.bar, voice })
    : issue.line ? t('@yovoice.melody.where.line', { line: issue.line }) : '';
  const reason = t(`@yovoice.melody.issue.${issue.code || 'token'}`);
  return where ? t('@yovoice.melody.issueAt', { where, reason }) : reason;
}

/** 未知错误的文案不含原因，附上底层细节，避免宿主或服务报告的具体原因被吞掉。 */
function translate(t: TranslatorFn, code: MessageCode, params?: MessageParams | null): string {
  if (code === '@yovoice.error.melodyInvalid') return t(code, { issue: formatMelodyIssue(t, (params ?? {}) as unknown as MelodyIssue) });
  const message = t(code, params ?? undefined);
  return code === unknownCode && params?.detail ? `${message} (${String(params.detail)})` : message;
}

/** 渲染 noticeMessage 生成的文本：翻译消息码，并附上底层原因。 */
export function formatNotice(t: TranslatorFn, text: string): string {
  const split = text.indexOf('::');
  const code = split < 0 ? text : text.slice(0, split);
  if (!code.startsWith('@yovoice.')) return text;
  return translate(t, code as MessageCode, split < 0 ? undefined : { detail: text.slice(split + 2) });
}

/** Translate CallError or activity errorCode. */
export function formatCallError(t: TranslatorFn, error: unknown): string {
  if (error instanceof CallError) return translate(t, error.code, error.params);
  if (error && typeof error === 'object' && 'errorCode' in error) {
    const activity = error as Activity;
    if (activity.errorCode) return translate(t, activity.errorCode, activity.errorParams);
  }
  if (error instanceof Error && error.message.startsWith('@yovoice.')) {
    return t(error.message as MessageCode);
  }
  if (typeof error === 'string' && error.startsWith('@yovoice.')) {
    return t(error as MessageCode);
  }
  const detail = error instanceof Error ? error.message : String(error ?? '');
  return translate(t, unknownCode, detail ? { detail } : undefined);
}

export function formatActivityError(t: TranslatorFn, activity: Activity | null | undefined): string | null {
  if (!activity?.errorCode) return null;
  return translate(t, activity.errorCode, activity.errorParams);
}
