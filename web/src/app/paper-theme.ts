import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

// yovoice 主题：在 neutral 之上换成暖纸色底、墨色文字和一点橙色点缀，界面像放在桌上的纸与胶片。
// 应用只用浅色模式，这里只给单值。修改后运行 `pnpm exec astryx theme build src/app/paper-theme.ts` 重新生成 yovoice-paper.*。
const ink = '#1C1A17';
const shade = (alpha: number) => `oklch(0.28 0.02 60 / ${alpha}%)`;

export const paperTheme = defineTheme({
  name: 'yovoice-paper',
  extends: neutralTheme,
  tokens: {
    '--color-background-body': '#F2EFE9',
    '--color-background-surface': '#FFFFFF',
    '--color-background-card': '#FFFFFF',
    '--color-background-popover': '#FFFFFF',
    '--color-background-muted': '#ECE8E1',
    '--color-background-inverted': '#191714',
    '--color-accent': ink,
    '--color-text-accent': ink,
    '--color-icon-accent': ink,
    '--color-accent-muted': '#ECE8E1',
    '--color-text-primary': ink,
    '--color-text-secondary': '#6F695F',
    '--color-text-disabled': '#AAA398',
    '--color-icon-primary': ink,
    '--color-icon-secondary': '#7C7569',
    '--color-icon-disabled': '#AAA398',
    '--color-border': '#1C1A1714',
    '--color-border-emphasized': '#D8D2C7',
    '--color-icon-orange': '#E0651C',
    '--color-text-orange': '#9A3F0B',
    '--color-background-orange': '#FBE6D6',
    '--color-shadow': shade(10),
    '--color-overlay': '#1C1A1766',
    '--radius-inner': '0.375rem',
    '--radius-element': '0.625rem',
    '--radius-container': '0.875rem',
    '--shadow-low': `0 1px 2px ${shade(6)}, 0 4px 12px ${shade(6)}`,
    '--shadow-med': `0 1px 2px ${shade(8)}, 0 12px 32px ${shade(10)}`,
    '--shadow-high': `0 2px 4px ${shade(10)}, 0 24px 56px ${shade(16)}`,
  },
});
