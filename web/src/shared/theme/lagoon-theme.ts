import { defineTheme } from '@astryxdesign/core/theme';
import { paletteTokens, type Palette } from './palette';
import { paperTheme } from './paper-theme';

// 青岸：取自应用图标的青色：浅色底，按钮、选中态用品牌青。
export const lagoonPalette: Palette = {
  body: '#F1F6F6', surface: '#FFFFFF', popover: '#FFFFFF', muted: '#E2EDED', inverted: '#0D2427',
  text: '#0D2427', secondary: '#4F6A6C', disabled: '#9DB2B3', iconSecondary: '#5E7A7C',
  accent: '#0B7A80', onAccent: '#FFFFFF', accentMuted: '#DDEFEF',
  border: '#06272A1A', borderEmphasized: '#C6DADA',
  highlight: '#139AA2',
  orange: { icon: '#E0651C', text: '#9A3F0B', background: '#FBE6D6' },
  shade: 'oklch(0.25 0.03 200', shadeScale: 1,
  overlay: '#0D242766',
};

export const lagoonTheme = defineTheme({
  name: 'yovoice-lagoon',
  extends: paperTheme,
  tokens: paletteTokens(lagoonPalette),
  localTokens: { '--theme-highlight': lagoonPalette.highlight },
});
