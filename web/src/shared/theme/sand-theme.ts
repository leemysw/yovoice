import { defineTheme } from '@astryxdesign/core/theme';
import { paletteTokens, type Palette } from './palette';
import { paperTheme } from './paper-theme';

// 宣纸：暖米色底配赭石强调，像在纸上写稿，适合长时间写台词。
export const sandPalette: Palette = {
  body: '#F3EEE4', surface: '#FBF8F1', popover: '#FFFDF8', muted: '#EAE2D4', inverted: '#2B241D',
  text: '#2B241D', secondary: '#6B6052', disabled: '#ADA393', iconSecondary: '#7A6E5E',
  accent: '#9A4A24', onAccent: '#FFF8F0', accentMuted: '#F1E4D6',
  border: '#3C281419', borderEmphasized: '#DCD2C2',
  highlight: '#C2662D',
  orange: { icon: '#E0651C', text: '#9A3F0B', background: '#FBE6D6' },
  shade: 'oklch(0.3 0.03 60', shadeScale: 1,
  overlay: '#2B241D66',
};

export const sandTheme = defineTheme({
  name: 'yovoice-sand',
  extends: paperTheme,
  tokens: paletteTokens(sandPalette),
  localTokens: { '--theme-highlight': sandPalette.highlight },
});
