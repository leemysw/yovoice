import { useSyncExternalStore } from 'react';
import type { DefinedTheme } from '@astryxdesign/core/theme';
import type { AppTheme } from '../workbench';
import { readLocal, writeLocal } from '../lib/local-store';
import { yovoicePaperTheme } from './yovoice-paper';
import { yovoiceInkTheme } from './yovoice-ink';
import { yovoiceLagoonTheme } from './yovoice-lagoon';
import { yovoiceSandTheme } from './yovoice-sand';
import { yovoiceSageTheme } from './yovoice-sage';
import { yovoiceAbyssTheme } from './yovoice-abyss';

// 已构建的主题与深浅：深色主题用 dark 模式，未覆盖的 Astryx 令牌（状态色、悬停等）取深色一侧。
// 各主题的 CSS 由 main.tsx 一次性引入。
export const themeEntries: Record<AppTheme, { theme: DefinedTheme; dark: boolean }> = {
  paper: { theme: yovoicePaperTheme, dark: false },
  ink: { theme: yovoiceInkTheme, dark: true },
  lagoon: { theme: yovoiceLagoonTheme, dark: false },
  sand: { theme: yovoiceSandTheme, dark: false },
  sage: { theme: yovoiceSageTheme, dark: false },
  abyss: { theme: yovoiceAbyssTheme, dark: true },
};

// 跟随系统：浅色用纸白，深色用夜墨。
export type ThemeChoice = AppTheme | 'system';
export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): AppTheme => choice === 'system' ? (systemDark ? 'ink' : 'paper') : choice;

// 当前选择：偏好随状态推送到达前先用上次的选择，启动时不会先闪一下纸白再换成深色。
const cacheKey = 'yovoice-theme';
const isChoice = (value: string | null): value is ThemeChoice => value === 'system' || (!!value && value in themeEntries);
const cached = readLocal(cacheKey);
let choice: ThemeChoice = isChoice(cached) ? cached : 'system';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** 应用偏好里的主题；undefined 表示跟随系统。 */
export function setThemeChoice(theme: AppTheme | undefined) {
  const next: ThemeChoice = theme ?? 'system';
  if (next === choice) return;
  choice = next;
  writeLocal(cacheKey, next);
  listeners.forEach(listener => listener());
}

export const useThemeChoice = () => useSyncExternalStore(subscribe, () => choice);

const darkQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;
const subscribeSystem = (listener: () => void) => { darkQuery?.addEventListener('change', listener); return () => darkQuery?.removeEventListener('change', listener); };
export const useSystemDark = () => useSyncExternalStore(subscribeSystem, () => !!darkQuery?.matches);
