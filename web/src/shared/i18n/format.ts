import type { TranslatorFn } from '@astryxdesign/core/i18n';
import type { Activity, MessageCode, MessageParams } from '../workbench';
import { CallError } from '../lib/callError';

const unknownCode = '@yovoice.error.unknown' as MessageCode;

/** Translate activity.code; missing keys fall back to unknown (never paint Chinese). */
export function formatActivity(t: TranslatorFn, activity: Activity | null | undefined): string {
  if (!activity?.code) return t(unknownCode);
  return t(activity.code, activity.params ?? undefined);
}

/** Translate CallError or activity errorCode. */
export function formatCallError(t: TranslatorFn, error: unknown): string {
  if (error instanceof CallError) return t(error.code, error.params);
  if (error && typeof error === 'object' && 'errorCode' in error) {
    const activity = error as Activity;
    if (activity.errorCode) return t(activity.errorCode, activity.errorParams ?? undefined);
  }
  if (error instanceof Error && error.message.startsWith('@yovoice.')) {
    return t(error.message as MessageCode);
  }
  if (typeof error === 'string' && error.startsWith('@yovoice.')) {
    return t(error as MessageCode);
  }
  const detail = error instanceof Error ? error.message : String(error ?? '');
  return t(unknownCode, detail ? { detail } : undefined);
}

export function formatActivityError(t: TranslatorFn, activity: Activity | null | undefined): string | null {
  if (!activity?.errorCode) return null;
  return t(activity.errorCode, (activity.errorParams ?? undefined) as MessageParams | undefined);
}
