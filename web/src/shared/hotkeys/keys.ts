// 按键的写法：修饰键在前、一个键在后，用 + 连接，如 "mod+shift+K"、"alt+#"、"space"。
// mod 在 macOS 上是 ⌘，其他平台是 Ctrl；ctrl 在 macOS 上是 ⌃，其他平台与 mod 相同。
// 字母按键帽上的字认（event.key，跟随 AZERTY、QWERTZ 等布局）；俄语等非拉丁布局或 ⌥ 改写成特殊字符时按物理键位认。
// 数字、符号与其他键按物理位置（KeyboardEvent.code）认，Shift 不改变它们；# 表示 1–9 中的任意数字。

export type Platform = 'mac' | 'other';
const modifiers = ['mod', 'ctrl', 'alt', 'shift'] as const;
type Modifier = typeof modifiers[number];

const named: Record<string, string> = {
  Enter: 'enter', NumpadEnter: 'enter', Space: 'space', Tab: 'tab', Escape: 'esc', Backspace: 'backspace', Delete: 'delete',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
  Equal: '=', Minus: '-', NumpadAdd: '=', NumpadSubtract: '-',
};
// 小键盘在 NumLock 关闭时报的是方向键等，按 event.key 认。
const numpadKeys: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', Delete: 'delete', Insert: 'insert',
};
/** 可以出现在按键里的键名（字母大写，# 是一组数字）。 */
const keyNames = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#'.split(''), ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
  'enter', 'space', 'tab', 'esc', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  ',', '.', '/', ';', "'", '[', ']', '\\', '`', '=', '-',
]);
/** 会打出字符的键：字母、数字、符号与空格。 */
const characterKey = (key: string) => key.length === 1 || key === 'space';

/** 按下的键（不含修饰键）；只按了修饰键或认不出时返回 null。 */
export function eventKey(event: Pick<KeyboardEvent, 'code' | 'key'>): string | null {
  const { code, key } = event;
  if (/^Key[A-Z]$/.test(code)) return /^[a-z]$/i.test(key) ? key.toUpperCase() : code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return /^\d$/.test(key) ? code.slice(6) : numpadKeys[key] ?? null;
  if (/^F([1-9]|1[0-2])$/.test(code)) return code.toLowerCase();
  if (code === 'NumpadDecimal') return key === 'Delete' ? 'delete' : null;
  if (named[code]) return named[code];
  // 没有 code 的合成事件按字符认字母和数字。
  if (!code && /^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  return null;
}

/**
 * 事件按下的修饰键，按 binding 的写法：macOS 上 ⌘ 是 mod、⌃ 是 ctrl，其他平台 Ctrl 是 mod。
 * 其他平台按着 Win 键，或按的是 AltGr（Windows 把它报成 Ctrl+Alt，用来打 @ { } 等字符）时不算快捷键，返回 null。
 */
export function eventModifiers(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & { getModifierState?: (key: string) => boolean }, platform: Platform): Modifier[] | null {
  if (platform === 'other' && (event.metaKey || event.getModifierState?.('AltGraph'))) return null;
  const mods: Modifier[] = [];
  if (platform === 'mac' ? event.metaKey : event.ctrlKey) mods.push('mod');
  if (platform === 'mac' && event.ctrlKey) mods.push('ctrl');
  if (event.altKey) mods.push('alt');
  if (event.shiftKey) mods.push('shift');
  return mods;
}

/** 整理成固定写法：修饰键按 mod、ctrl、alt、shift 排序，其他平台的 ctrl 并入 mod。 */
export function normalizeBinding(binding: string, platform: Platform): string {
  if (!binding) return '';
  const parts = binding.split('+');
  const key = parts.pop()!;
  const mods = new Set(parts.map(part => (platform === 'other' && part === 'ctrl' ? 'mod' : part)));
  return [...modifiers.filter(mod => mods.has(mod)), key].join('+');
}

/** 整理一条外来的按键（导入的文件）：字母转大写、键名转小写；修饰键重复、未知键名或写法不对时返回 null。空字符串表示清除。 */
export function canonicalBinding(raw: string, platform: Platform): string | null {
  if (raw === '') return '';
  if (raw.length > 32) return null;
  const parts = raw.split('+');
  const last = parts.pop()!;
  const key = last.length === 1 ? last.toUpperCase() : last.toLowerCase();
  if (!keyNames.has(key) || parts.some(part => !(modifiers as readonly string[]).includes(part)) || new Set(parts).size !== parts.length) return null;
  return normalizeBinding([...parts, key].join('+'), platform);
}

/** 事件对应的按键；有数字时同时给出 # 的写法与第几个（0 起）。 */
export function eventBindings(event: KeyboardEvent, platform: Platform): { binding: string; index?: number }[] {
  const key = eventKey(event), mods = eventModifiers(event, platform);
  if (!key || !mods) return [];
  // Windows 上按住 Alt 用小键盘输入字符码（Alt+0171 打出 «），不当快捷键。
  if (platform === 'other' && mods.includes('alt') && /^Numpad\d$/.test(event.code)) return [];
  const prefix = mods.length ? mods.join('+') + '+' : '';
  const result: { binding: string; index?: number }[] = [{ binding: prefix + key }];
  if (/^[1-9]$/.test(key)) result.push({ binding: prefix + '#', index: Number(key) - 1 });
  // “+” 在多数布局上要按 ⇧=，⌘+ 与 ⌘= 都算放大。
  if (key === '=' && mods.includes('shift')) result.push({ binding: [...mods.filter(mod => mod !== 'shift'), key].join('+') });
  return result;
}

/**
 * 系统通用的撤销与重做（不可修改）：撤销 ⌘Z / Ctrl+Z，重做 ⇧⌘Z / Ctrl+Shift+Z，Windows 与 Linux 上 Ctrl+Y 也是重做。
 * 字母按 event.key 认（跟随键盘布局，AZERTY 上按的就是标着 Z 的键），⌥ 等改写成别的字符时才按物理键位。
 */
export function historyAction(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, platform: Platform): 'undo' | 'redo' | null {
  const mods = eventModifiers(event, platform);
  if (!mods || mods.some(mod => mod !== 'mod' && mod !== 'shift') || !mods.includes('mod')) return null;
  const letter = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : '';
  if (letter === 'z') return event.shiftKey ? 'redo' : 'undo';
  return letter === 'y' && platform === 'other' && !event.shiftKey ? 'redo' : null;
}

/** 带 ⌘/Ctrl、⌃ 或 ⌥ 的按键在输入框里也能用；其余（单键、Shift 组合、方向键）打字时不触发。 */
export const hasCommandModifier = (binding: string) => /(^|\+)(mod|ctrl|alt)\+/.test(binding);

/** macOS 上只带 ⌥（可加 ⇧）的字母、数字、符号或空格：在输入框里是用来打 é、ñ、@、[ 等字符的，不能当快捷键抢走。 */
export function typesCharacter(binding: string, platform: Platform): boolean {
  if (platform !== 'mac' || !binding) return false;
  const parts = binding.split('+');
  const key = parts.pop()!;
  return parts.includes('alt') && parts.every(part => part === 'alt' || part === 'shift') && characterKey(key);
}

/** 方向、翻页与 Home/End：滑块和列表自己用这些键移动。 */
export const navigationKey = (binding: string) => /^(up|down|left|right|home|end|pageup|pagedown)$/.test(binding);

const macGlyph: Record<string, string> = { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', enter: '↵', backspace: '⌫', delete: '⌦', esc: 'Esc', tab: '⇥' };
const otherName: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', enter: 'Enter', backspace: 'Backspace', delete: 'Delete', esc: 'Esc', tab: 'Tab' };
const common: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→', space: 'Space', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn', '=': '+' };

// 符号键在当前键盘布局上印的字（Chromium 的 navigator.keyboard 提供，WebView2 有，WebKit 没有）：德语键盘上 ⌘/ 实际按的是标着 - 的键。
const symbolCodes = Object.fromEntries(Object.entries(named).filter(([code, key]) => key.length === 1 && !code.startsWith('Numpad')).map(([code, key]) => [key, code]));
let layout: Map<string, string> | undefined;
/** 读取键盘布局，之后符号键按布局上的字显示；不支持时沿用美式键名。 */
export async function loadKeyboardLayout(): Promise<void> {
  const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  try { layout = await keyboard?.getLayoutMap?.(); } catch { layout = undefined; }
}
const symbolLabel = (key: string) => { const code = symbolCodes[key]; const printed = code ? layout?.get(code) : undefined; return printed && printed.trim() ? printed.toUpperCase() : undefined; };

/** 每个键在界面上的写法：macOS 用符号（修饰键按 ⌃⌥⇧⌘ 的系统顺序），其他平台用英文名；# 显示成 1–range。 */
export function bindingLabels(binding: string, platform: Platform, range = 9): string[] {
  if (!binding) return [];
  const parts = normalizeBinding(binding, platform).split('+');
  const key = parts.pop()!;
  const order = platform === 'mac' ? ['ctrl', 'alt', 'shift', 'mod'] : ['mod', 'alt', 'shift'];
  const names = platform === 'mac' ? macGlyph : otherName;
  const label = (part: string) => part === '#' ? `1–${range}` : names[part] ?? (key === part && part !== '=' ? symbolLabel(part) : undefined) ?? common[part] ?? part.toUpperCase();
  return [...order.filter(mod => parts.includes(mod)).map(label), label(key)];
}

/** 写在一起的按键，用于提示文字：macOS 上符号连写（⌘⇧K），其他平台用 + 连接（Ctrl+Shift+K）。 */
export const bindingText = (binding: string, platform: Platform, range?: number) => bindingLabels(binding, platform, range).join(platform === 'mac' ? '' : '+');

const ariaName: Record<string, string> = { mod: 'Meta', ctrl: 'Control', alt: 'Alt', shift: 'Shift', enter: 'Enter', backspace: 'Backspace', delete: 'Delete', esc: 'Escape', tab: 'Tab', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: 'Space', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', '=': 'Plus' };
/** aria-keyshortcuts 的写法（Meta+Shift+K）；数字组合取 1。 */
export function bindingAria(binding: string, platform: Platform): string {
  if (!binding) return '';
  return normalizeBinding(binding, platform).split('+').map(part => part === 'mod' ? (platform === 'mac' ? 'Meta' : 'Control') : part === '#' ? '1' : ariaName[part] ?? part.toUpperCase()).join('+');
}

// 系统、窗口管理或输入法占用、不能用作快捷键的按键。
const reservedMac = [
  'mod+Q', 'mod+shift+Q', 'ctrl+mod+Q', 'mod+W', 'mod+H', 'alt+mod+H', 'mod+M', 'mod+tab', 'mod+shift+tab', 'mod+`',
  // Spotlight、切换输入法、表情与符号、强制退出、程序坞、全屏、截屏、调度中心
  'mod+space', 'alt+mod+space', 'ctrl+space', 'ctrl+alt+space', 'ctrl+mod+space', 'alt+mod+esc', 'alt+mod+D', 'ctrl+mod+F',
  'mod+shift+3', 'mod+shift+4', 'mod+shift+5', 'ctrl+up', 'ctrl+down', 'ctrl+left', 'ctrl+right',
  'mod+C', 'mod+V', 'mod+X', 'mod+A', 'mod+Z', 'mod+shift+Z',
];
const reservedOther = [
  'alt+f4', 'alt+space', 'alt+tab', 'alt+shift+tab', 'mod+esc', 'mod+shift+esc',
  // 输入法：切换输入法、中英文标点（Ctrl+.）、简繁切换（微软拼音、搜狗、fcitx 的 Ctrl+Shift+F）、IBus 的 Unicode 输入与表情
  'mod+space', 'mod+.', 'mod+shift+F', 'mod+shift+U', 'mod+;',
  // Linux 桌面切换工作区；部分 Windows 显卡驱动用 Ctrl+Alt+方向键旋转屏幕
  'mod+alt+left', 'mod+alt+right', 'mod+alt+up', 'mod+alt+down',
  'mod+C', 'mod+V', 'mod+X', 'mod+A', 'mod+Z', 'mod+Y', 'mod+shift+Z',
];
/** 是不是系统保留的按键；单独的 Tab 与 Shift+Tab 用来在界面里移动焦点，也算保留。 */
export const isReserved = (binding: string, platform: Platform) => {
  const normalized = normalizeBinding(binding, platform);
  return normalized === 'tab' || normalized === 'shift+tab' || (platform === 'mac' ? reservedMac : reservedOther).some(item => normalizeBinding(item, platform) === normalized);
};
