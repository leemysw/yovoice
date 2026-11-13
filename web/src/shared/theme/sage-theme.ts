import { defineTheme } from '@astryxdesign/core/theme';
import { paletteTokens, type Palette } from './palette';
import { paperTheme } from './paper-theme';

// 苔绿：低饱和的灰绿，对比柔和，长时间看波形和时间轴更放松。
export const sagePalette: Palette = {
  body: '#EFF3ED', surface: '#FFFFFF', popover: '#FFFFFF', muted: '#E2E9DF', inverted: '#1C2620',
  text: '#1C2620', secondary: '#55635A', disabled: '#A3AFA6', iconSecondary: '#66746A',
  accent: '#3B6B4C', onAccent: '#FFFFFF', accentMuted: '#DFEADF',
  border: '#1E32231A', borderEmphasized: '#C9D5C5',
  highlight: '#5E8F45',
  orange: { icon: '#E0651C', text: '#9A3F0B', background: '#FBE6D6' },
  shade: 'oklch(0.28 0.02 150', shadeScale: 1,
  overlay: '#1C262066',
};

export const sageTheme = defineTheme({
  name: 'yovoice-sage',
  extends: paperTheme,
  tokens: paletteTokens(sagePalette),
  localTokens: { '--theme-highlight': sagePalette.highlight },
});
