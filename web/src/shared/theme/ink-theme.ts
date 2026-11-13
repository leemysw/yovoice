import { defineTheme } from '@astryxdesign/core/theme';
import { paletteTokens, type Palette } from './palette';
import { paperTheme } from './paper-theme';

// 夜墨：纸白的深色版：近黑中性底，强调色反转成浅墨，橙色点缀提亮一档。
export const inkPalette: Palette = {
  body: '#0F0F11', surface: '#18181B', popover: '#1F1F23', muted: '#232327', inverted: '#EDEDEF',
  text: '#EDEDEF', secondary: '#A1A1A7', disabled: '#5E5E64', iconSecondary: '#8E8E94',
  accent: '#EDEDEF', onAccent: '#111113', accentMuted: '#26262A',
  border: '#FFFFFF14', borderEmphasized: '#3A3A3F',
  highlight: '#F08A4B',
  orange: { icon: '#F08A4B', text: '#F7B48A', background: '#3A2416' },
  shade: 'oklch(0 0 0', shadeScale: 3,
  overlay: '#000000A6',
};

export const inkTheme = defineTheme({
  name: 'yovoice-ink',
  extends: paperTheme,
  tokens: paletteTokens(inkPalette),
  localTokens: { '--theme-highlight': inkPalette.highlight },
});
