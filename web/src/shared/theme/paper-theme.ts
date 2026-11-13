import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';
import { paletteTokens, type Palette } from './palette';

// 纸白：默认主题。在 neutral 之上用接近白的中性底、墨色文字和一点橙色点缀，保持干净不偏暖。
// 其余主题都继承它，只换调色板；圆角与开场动画的品牌色只在这里定义。
// 修改任一主题后运行 `pnpm exec astryx theme build src/shared/theme/*-theme.ts` 重新生成 yovoice-*.*。
const ink = '#18181A';

export const paperPalette: Palette = {
  body: '#F7F7F7', surface: '#FFFFFF', popover: '#FFFFFF', muted: '#EFEFEF', inverted: '#161617',
  text: ink, secondary: '#6B6B6E', disabled: '#A8A8AB', iconSecondary: '#77777A',
  accent: ink, onAccent: '#FFFFFF', accentMuted: '#EFEFEF',
  border: '#18181A14', borderEmphasized: '#D6D6D8',
  highlight: '#E0651C',
  orange: { icon: '#E0651C', text: '#9A3F0B', background: '#FBE6D6' },
  shade: 'oklch(0.25 0 0', shadeScale: 1,
  overlay: '#18181A66',
};

export const paperTheme = defineTheme({
  name: 'yovoice-paper',
  extends: neutralTheme,
  tokens: {
    ...paletteTokens(paperPalette),
    '--radius-inner': '0.375rem',
    '--radius-element': '0.625rem',
    '--radius-container': '0.875rem',
  },
  localTokens: {
    // 点缀色：波形、焦点框与进度，界面经 --app-wave / --app-accent 使用；各主题各自覆盖。
    '--theme-highlight': paperPalette.highlight,
    // 首次启动开场的品牌色：取自应用图标（深青、青色、米白），只在深色舞台上使用，不随主题变化。
    // 透明度变化在 styles.css 里用 color-mix 从这些颜色派生；多层的立体阴影整体放在这里，便于一起调整。
    '--intro-stage-center': '#06272A',
    '--intro-stage-mid': '#031416',
    '--intro-stage-edge': '#000000',
    '--intro-teal': '#19C3CD',
    '--intro-teal-light': '#78E8EE',
    '--intro-teal-pale': '#A6F2F5',
    '--intro-mist': '#E2F2F2',
    '--intro-cream': '#F7F2EA',
    '--intro-sand': '#DCD2C2',
    '--intro-word-side': '#0E8C93',
    '--intro-cta-ink': '#03292C',
    '--intro-cta-tint': '#F3FAF9',
    '--intro-cta-base': '#DCEEED',
    '--intro-cta-tint-hover': '#F6FCFB',
    '--intro-cta-base-hover': '#E3F3F2',
    // 标题的挤出侧面：逐层加深的品牌青，最后一层是落地阴影。
    '--intro-word-extrude': '0 1px 0 #14A8B1, 0 2px 0 #0F969E, 0 3px 0 #0C848B, 0 4px 0 #0A7379, 0 5px 0 #086268, 0 6px 0 #065358, 0 7px 0 #05464A, 0 8px 0 #043A3D, 0 20px 26px rgb(0 0 0 / 55%)',
    // 创作方式胶囊：顶部高光与下方投影。
    '--intro-kind-shadow': 'inset 0 1px 0 rgb(255 255 255 / 16%), 0 10px 26px rgb(0 0 0 / 35%)',
    // 「开始探索」按钮：静止、呼吸高峰与悬停三种光晕（顶部高光、底部内阴影、白色描边、投影、青色光晕）。
    '--intro-cta-shadow': 'inset 0 1px 0 #FFFFFF, inset 0 -3px 6px rgb(0 70 75 / 16%), 0 0 0 1px rgb(255 255 255 / 55%), 0 14px 34px rgb(0 0 0 / 45%), 0 0 46px rgb(25 195 205 / 32%)',
    '--intro-cta-shadow-pulse': 'inset 0 1px 0 #FFFFFF, inset 0 -3px 6px rgb(0 70 75 / 16%), 0 0 0 1px rgb(255 255 255 / 60%), 0 14px 34px rgb(0 0 0 / 45%), 0 0 62px rgb(25 195 205 / 50%)',
    '--intro-cta-shadow-hover': 'inset 0 1px 0 #FFFFFF, inset 0 -3px 6px rgb(0 70 75 / 14%), 0 0 0 1px rgb(255 255 255 / 70%), 0 18px 40px rgb(0 0 0 / 50%), 0 0 64px rgb(25 195 205 / 55%)',
  },
});
