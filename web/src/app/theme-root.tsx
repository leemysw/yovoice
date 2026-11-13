import { useEffect, type ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { call } from '../shared/lib/client';
import { isDesktop } from '../shared/lib/bridge';
import { resolveTheme, themeEntries, useSystemDark, useThemeChoice } from '../shared/theme/themes';

// 根主题：按偏好（或跟随系统外观）选择主题。必须是最外层的 Theme，
// 它把 data-astryx-theme 同步到 <html>，弹窗、菜单等挂在 body 下的浮层才会用同一套颜色。
export function ThemeRoot({ children }: { children: ReactNode }) {
  const choice = useThemeChoice();
  const entry = themeEntries[resolveTheme(choice, useSystemDark())];
  // 告诉宿主页面底色与深浅：macOS 的透明标题栏露出窗口底色，要和页面一致。
  const background = entry.theme.tokens['--color-background-body'];
  useEffect(() => {
    if (isDesktop) void call('window.theme', { background, dark: entry.dark, system: choice === 'system' }).catch(() => undefined);
  }, [background, entry.dark, choice]);
  return <Theme theme={entry.theme} mode={entry.dark ? 'dark' : 'light'}>{children}</Theme>;
}
