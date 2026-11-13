// 各主题共用的颜色映射：每套主题只给一组调色板，按同一规则展开成 Astryx 令牌，保证每套覆盖的令牌一致、不漏项。
// 圆角、阴影形状和开场动画的品牌色都在纸白主题里，其余主题继承纸白，只换这里的颜色。
export interface Palette {
  body: string; surface: string; popover: string; muted: string; inverted: string;
  text: string; secondary: string; disabled: string; iconSecondary: string;
  accent: string; onAccent: string; accentMuted: string;
  border: string; borderEmphasized: string;
  // 点缀色：波形已播放部分、焦点框、进度等（界面里的 --app-wave / --app-accent）。
  highlight: string;
  // 状态橙（提醒、待更新），深色主题要提亮，否则在深底上看不清。
  orange: { icon: string; text: string; background: string };
  // 阴影基色（不含透明度的 oklch 前半段）与透明度倍数：深色底上阴影要更重才看得出层次。
  shade: string; shadeScale: number;
  overlay: string;
}

export function paletteTokens(p: Palette) {
  const shade = (alpha: number) => `${p.shade} / ${Math.min(100, alpha * p.shadeScale)}%)`;
  return {
    '--color-background-body': p.body,
    '--color-background-surface': p.surface,
    '--color-background-card': p.surface,
    '--color-background-popover': p.popover,
    '--color-background-muted': p.muted,
    '--color-background-inverted': p.inverted,
    '--color-accent': p.accent,
    '--color-text-accent': p.accent,
    '--color-icon-accent': p.accent,
    '--color-accent-muted': p.accentMuted,
    // 覆盖 --color-accent 不会同步强调色上的文字颜色，需要一起给出。
    '--color-on-accent': p.onAccent,
    '--color-text-primary': p.text,
    '--color-text-secondary': p.secondary,
    '--color-text-disabled': p.disabled,
    '--color-icon-primary': p.text,
    '--color-icon-secondary': p.iconSecondary,
    '--color-icon-disabled': p.disabled,
    '--color-border': p.border,
    '--color-border-emphasized': p.borderEmphasized,
    '--color-icon-orange': p.orange.icon,
    '--color-text-orange': p.orange.text,
    '--color-background-orange': p.orange.background,
    '--color-shadow': shade(10),
    '--color-overlay': p.overlay,
    '--shadow-low': `0 1px 2px ${shade(6)}, 0 4px 12px ${shade(6)}`,
    '--shadow-med': `0 1px 2px ${shade(8)}, 0 12px 32px ${shade(10)}`,
    '--shadow-high': `0 2px 4px ${shade(10)}, 0 24px 56px ${shade(16)}`,
  } as const;
}
