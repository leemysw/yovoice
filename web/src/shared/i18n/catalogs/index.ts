import type { Catalog, MessagesByLocale } from '@astryxdesign/core/i18n';
import en from './en.json';
import zhCN from './zh-CN.json';

export const appMessages = {
  en: en as Catalog,
  'zh-CN': zhCN as Catalog,
};

/** Provider messages bag: en = app only; zh-CN = astryxZhCN ∪ app zh-CN. */
export function buildProviderMessages(astryxZhCN: Catalog, app: typeof appMessages): MessagesByLocale {
  return {
    en: app.en,
    'zh-CN': { ...astryxZhCN, ...app['zh-CN'] },
  };
}
