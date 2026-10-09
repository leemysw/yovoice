import type { TranslatorFn } from '@astryxdesign/core/i18n';
import type { Activity, MessageCode, MessageParams } from '../workbench';
import { CallError } from '../lib/call-error';

const unknownCode = '@yovoice.error.unknown' as MessageCode;

/** Translate activity.code; missing keys fall back to unknown (never paint Chinese). */
export function formatActivity(t: TranslatorFn, activity: Activity | null | undefined): string {
  if (!activity?.code) return t(unknownCode);
  return t(activity.code, activity.params ?? undefined);
}

/** 未知错误的文案不含原因，附上底层细节，避免宿主或服务报告的具体原因被吞掉。 */
function translate(t: TranslatorFn, code: MessageCode, params?: MessageParams | null): string {
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
