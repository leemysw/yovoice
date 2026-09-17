import { useEffect, useMemo, type ReactNode } from 'react';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import astryxZhCN from '@astryxdesign/core/locales/zh-CN.json';
import type { Catalog } from '@astryxdesign/core/i18n';
import { appMessages, buildProviderMessages } from '../shared/i18n/catalogs';
import { isUiLocale, resolveInitialUiLocale } from '../shared/i18n/locale';
import type { Preferences, UiLocale } from '../shared/workbench';
import { call } from '../shared/lib/client';

const bootLocale = resolveInitialUiLocale(typeof navigator !== 'undefined' ? navigator.language : 'en');
const providerMessages = buildProviderMessages(astryxZhCN as Catalog, appMessages);

export type LocaleShellProps = {
  preferencesLocale: UiLocale | null | undefined;
  children: ReactNode;
};

/**
 * Owns InternationalizationProvider locale + documentElement.lang.
 * Boot uses navigator until preferences.uiLocale arrives.
 */
export function LocaleShell({ preferencesLocale, children }: LocaleShellProps) {
  const locale = isUiLocale(preferencesLocale) ? preferencesLocale : bootLocale;
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const messages = useMemo(() => providerMessages, []);
  return (
    <InternationalizationProvider locale={locale} messages={messages}>
      {children}
    </InternationalizationProvider>
  );
}

/** Persist navigator-derived uiLocale once when preferences omit a valid value. */
export async function ensureUiLocalePersisted(
  preferences: Preferences,
  resolved: UiLocale = bootLocale,
): Promise<void> {
  if (isUiLocale(preferences.uiLocale)) return;
  await call('preferences.save', { ...preferences, uiLocale: resolved });
}

export { bootLocale };
