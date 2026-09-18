import type { UiLocale } from '../workbench';

/** First-launch default from navigator.language. */
export function resolveInitialUiLocale(navigatorLanguage: string): UiLocale {
  const tag = navigatorLanguage.trim().toLowerCase();
  return tag === 'zh' || tag.startsWith('zh-') ? 'zh-CN' : 'en';
}

/** Boundary parse for preferences.uiLocale (JSON / RPC). */
export function parseUiLocale(raw: unknown): UiLocale {
  if (raw === 'zh-CN' || raw === 'en') return raw;
  throw new Error(`unsupported uiLocale: ${String(raw)}`);
}

export function isUiLocale(raw: unknown): raw is UiLocale {
  return raw === 'zh-CN' || raw === 'en';
}
