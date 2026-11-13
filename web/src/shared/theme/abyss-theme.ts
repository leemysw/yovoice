import { defineTheme } from '@astryxdesign/core/theme';
import { paletteTokens, type Palette } from './palette';
import { paperTheme } from './paper-theme';

// 深海：把开场动画的深青舞台延续到工作台：深色底、亮青强调。
export const abyssPalette: Palette = {
  body: '#04181A', surface: '#082427', popover: '#0C2C30', muted: '#0F3438', inverted: '#E2F2F2',
  text: '#E2F2F2', secondary: '#8FB3B4', disabled: '#4A6A6C', iconSecondary: '#7FA3A4',
  accent: '#19C3CD', onAccent: '#03292C', accentMuted: '#0E3E42',
  border: '#A6F2F51A', borderEmphasized: '#1D4A4E',
  highlight: '#78E8EE',
  orange: { icon: '#F08A4B', text: '#F7B48A', background: '#3A2416' },
  shade: 'oklch(0 0 0', shadeScale: 3,
  overlay: '#000000A6',
};

export const abyssTheme = defineTheme({
  name: 'yovoice-abyss',
  extends: paperTheme,
  tokens: paletteTokens(abyssPalette),
  localTokens: { '--theme-highlight': abyssPalette.highlight },
});
