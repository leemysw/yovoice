import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

// yovoice 主题：在 neutral 之上用接近白的中性底、墨色文字和一点橙色点缀，保持干净不偏暖。
// 应用只用浅色模式，这里只给单值。修改后运行 `pnpm exec astryx theme build src/app/paper-theme.ts` 重新生成 yovoice-paper.*。
const ink = '#18181A';
const shade = (alpha: number) => `oklch(0.25 0 0 / ${alpha}%)`;

export const paperTheme = defineTheme({
  name: 'yovoice-paper',
  extends: neutralTheme,
  tokens: {
    '--color-background-body': '#F7F7F7',
    '--color-background-surface': '#FFFFFF',
    '--color-background-card': '#FFFFFF',
    '--color-background-popover': '#FFFFFF',
    '--color-background-muted': '#EFEFEF',
    '--color-background-inverted': '#161617',
    '--color-accent': ink,
    '--color-text-accent': ink,
    '--color-icon-accent': ink,
    '--color-accent-muted': '#EFEFEF',
    '--color-text-primary': ink,
    '--color-text-secondary': '#6B6B6E',
    '--color-text-disabled': '#A8A8AB',
    '--color-icon-primary': ink,
    '--color-icon-secondary': '#77777A',
    '--color-icon-disabled': '#A8A8AB',
    '--color-border': '#18181A14',
    '--color-border-emphasized': '#D6D6D8',
    '--color-icon-orange': '#E0651C',
    '--color-text-orange': '#9A3F0B',
    '--color-background-orange': '#FBE6D6',
    '--color-shadow': shade(10),
    '--color-overlay': '#18181A66',
    '--radius-inner': '0.375rem',
    '--radius-element': '0.625rem',
    '--radius-container': '0.875rem',
    '--shadow-low': `0 1px 2px ${shade(6)}, 0 4px 12px ${shade(6)}`,
    '--shadow-med': `0 1px 2px ${shade(8)}, 0 12px 32px ${shade(10)}`,
    '--shadow-high': `0 2px 4px ${shade(10)}, 0 24px 56px ${shade(16)}`,
  },
});
