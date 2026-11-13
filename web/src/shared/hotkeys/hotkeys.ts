import { useEffect, useEffectEvent, useState, useSyncExternalStore, type RefObject } from 'react';
import { isDesktop, isMac } from '../lib/client';
import type { HotkeySettings } from '../workbench';
import { hotkeyCommand, hotkeyCommands, scopesMeet, type HotkeyCommand } from './commands';
import { bindingAria, bindingText, eventBindings, hasCommandModifier, isReserved, loadKeyboardLayout, navigationKey, normalizeBinding, typesCharacter, type Platform } from './keys';

// 快捷键的运行时：整个界面只有一个按键监听，按当前设置把按键对应到命令，再交给注册了这个命令的组件处理。
// 同一命令可以有多处注册（例如 ⌘N 在不同页面做不同的事）：限定了区域（within）且焦点在区域里的优先，其次是后挂载的。

// 桌面端按宿主报告的平台；浏览器预览按浏览器所在的系统，这样在 Mac 上预览时也用 ⌘。
export const platform: Platform = isMac || (!isDesktop && /Mac|iPhone|iPad/.test(navigator.platform)) ? 'mac' : 'other';

export const defaultBinding = (command: HotkeyCommand, on: Platform = platform) => normalizeBinding((on === 'other' && command.win) || command.key, on);

/** 按设置算出的按键：改过的用改过的（空字符串表示清除），其余用默认值；固定条目原样返回，可能含 | 分隔的几组。 */
export function bindingFor(settings: HotkeySettings | undefined, command: HotkeyCommand): string {
  if (command.fixed) return ((platform === 'other' && command.win) || command.key).split('|').map(item => normalizeBinding(item, platform)).join('|');
  const custom = settings?.bindings?.[command.id];
  return custom === undefined ? defaultBinding(command) : normalizeBinding(custom, platform);
}

// 两个订阅源：按键设置变了，提示文字要跟着变；注册表变了（组件挂载、enabled 翻转），只有速查浮层关心。
let settings: HotkeySettings = {};
let recording = false;
const store = () => {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    notify: () => { version++; listeners.forEach(listener => listener()); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => version,
  };
};
const settingsStore = store(), registryStore = store();

/** 当前生效的按键；快捷键总开关或所在功能区关闭、或已清除时为空。 */
export function activeBinding(id: string): string {
  const command = hotkeyCommand.get(id);
  if (!command || settings.disabled || settings.off?.includes(command.area)) return '';
  return bindingFor(settings, command);
}

export interface HotkeyOptions {
  /** 为 false 时不响应，例如对应的按钮当前不可用。 */
  enabled?: boolean;
  /** 只在焦点位于这个元素里时响应，并优先于没有限定区域的注册。对话框里的命令用它指向对话框的内容。 */
  within?: RefObject<Element | null>;
  /** 不带 ⌘/Ctrl、⌥ 的按键默认在输入框里不触发；为 true 时照常触发。 */
  inInput?: boolean;
  /**
   * 有对话框打开时默认只响应焦点所在的那个对话框里（within 落在其中）的注册。
   * 为 true 时：没有 within 的全局命令（如速查浮层）在对话框上方也响应。
   */
  dialog?: boolean;
  /** 按住不放时是否重复触发（快退快进、换行这类）；默认只触发一次。 */
  repeat?: boolean;
  /** 空格、回车落在用键盘选中的按钮上时默认交给按钮；为 true 时照常触发（时间线上选中片段后按空格播放）。 */
  onControl?: boolean;
  /** 兜底的注册：同一按键有其他可用的注册时让给它们（例如 ⌘. 先停当前页面的任务，没有时才停 Ocho 的回复）。 */
  fallback?: boolean;
}
interface Entry { id: string; order: number; run: (event: KeyboardEvent, index?: number) => void; options: HotkeyOptions }
const entries = new Set<Entry>();
let sequence = 0;

const dialogSelector = 'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]';
// 打字的地方：文本框、可编辑区域、数字框与组合框。滑块另算，只有方向键归它。
const editableSelector = 'textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="spinbutton"], [role="combobox"], input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="file"], [type="color"], [type="range"])';
const sliderSelector = 'input[type="range"], [role="slider"]';
// 空格、回车本身会按下的控件：按钮、链接、勾选、单选、开关、标签页与可展开的 <summary>。
const controlSelector = 'button, a[href], summary, [role="button"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], input[type="reset"], input[type="file"], input[type="color"]';
// 展开着菜单、下拉列表的触发按钮（对话框式弹层不算）：只在弹层打开时存在。
const openMenuSelector = '[aria-haspopup]:not([aria-haspopup="false"], [aria-haspopup="dialog"])[aria-expanded="true"]';
// Ocho 面板浮在页面之上：焦点在面板里时只响应面板自己的注册与全局命令，页面上的命令不抢它的按键。
const assistantSelector = '.assistant-panel';
// 只把模态的对话框算作“对话框打开”：原生 <dialog>（Astryx 对话框）、标了 aria-modal 的引导层与 alertdialog；Ocho 历史抽屉这类非模态面板不挡快捷键。
const visibleDialogs = () => Array.from(document.querySelectorAll(dialogSelector)).filter(element => element.getClientRects().length > 0);
/** 有模态对话框可见：组件自己处理的固定按键（撤销、Esc 等）据此让给对话框。 */
export const dialogOpen = () => visibleDialogs().length > 0;
/** 输入法正在组字：macOS 的 WebKit 组字时按回车 isComposing 可能是 false，但 keyCode 是 229。 */
export const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;
/** 焦点在打字的地方（文本框、可编辑区域）；滑块、勾选等控件不算，撤销重做在那里照常作用于整个编辑器。 */
export const typingTarget = (target: EventTarget | null) => target instanceof Element && !!target.closest('textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="file"], [type="color"])');
// 用键盘移到的控件才把空格、回车留给它；鼠标点过的按钮在 Windows / Linux 上仍留着焦点，这时空格照常播放、暂停。
// 要在焦点到达时记下是不是键盘移来的：Chromium 里一按键，鼠标点过的按钮也会变成 :focus-visible，按键时再查就分不出来了。
const pointerFocused = new WeakSet<Element>();
const onFocusIn = (event: FocusEvent) => {
  if (!(event.target instanceof Element)) return;
  let visible = true;
  try { visible = event.target.matches(':focus-visible'); } catch { /* 不支持 :focus-visible 时都当作键盘移来的 */ }
  if (visible) pointerFocused.delete(event.target); else pointerFocused.add(event.target);
};
const keyboardFocused = (element: Element) => !pointerFocused.has(element);

/** 这次按键该交给哪条注册；held 表示匹配上了、只是不允许按住重复。分发与 claimedByHotkey 共用这一套判断。 */
function pick(event: KeyboardEvent): { best?: { entry: Entry; index?: number }; held: boolean } {
  if (recording || settings.disabled || event.defaultPrevented || composing(event)) return { held: false };
  const candidates = eventBindings(event, platform);
  if (!candidates.length) return { held: false };
  const target = event.target instanceof Element ? event.target : document.activeElement;
  const editable = !!target?.closest(editableSelector);
  const slider = !!target?.closest(sliderSelector);
  // 菜单打开后下一帧才把焦点移进去，这之间焦点可能还在触发按钮上、或已落到别处（全屏弹窗会把落到 body 的焦点放回根元素）；
  // 有展开着的菜单（触发按钮标着 aria-expanded）时，按键同样归菜单。
  const inMenu = !!target?.closest('[role="menu"], [role="menuitem"], [role="listbox"], [role="option"]') || !!document.querySelector(openMenuSelector);
  const control = target?.closest(controlSelector);
  const onControl = !!control && keyboardFocused(control);
  const inAssistant = !!target?.closest(assistantSelector);
  let dialogs: Element[] | undefined;
  let best: { entry: Entry; index?: number; depth: number } | undefined;
  let held = false;
  for (const entry of entries) {
    const command = hotkeyCommand.get(entry.id);
    if (!command || command.fixed || settings.off?.includes(command.area)) continue;
    const binding = bindingFor(settings, command);
    const match = binding ? candidates.find(candidate => candidate.binding === binding) : undefined;
    if (!match || (match.index !== undefined && match.index >= (command.range ?? 9))) continue;
    const { enabled = true, within, inInput = false, dialog = false, repeat = false, onControl: overControl = false } = entry.options;
    if (!enabled) continue;
    // 打字的按键（不带修饰键，或 macOS 上只带 ⌥ 的字符）在输入框里交给输入框；方向键在滑块上归滑块；菜单里的移动、按钮上的空格与回车都交给原本的控件。
    const plain = !hasCommandModifier(binding) || typesCharacter(binding, platform);
    if (plain && ((editable && !inInput) || (slider && navigationKey(binding)) || inMenu || (onControl && !overControl && (binding === 'space' || binding === 'enter')))) continue;
    const area = within?.current;
    if (within && (!area || !target || !area.contains(target))) continue;
    if (inAssistant && !area && command.scope !== 'global') continue;
    dialogs ??= visibleDialogs();
    if (dialogs.length) {
      // 焦点所在的对话框（焦点不在任何对话框里、又只有一个对话框时，算那一个）；只响应其中的注册，被别的对话框盖住的不响应。
      const top = target?.closest(dialogSelector) ?? (dialogs.length === 1 ? dialogs[0] : null);
      if (!(area && top?.contains(area)) && !(dialog && !area)) continue;
    }
    // 不允许按住重复的命令：重复的按键也拦下，免得交给系统菜单后连声提示，或让空格滚动页面。
    if (event.repeat && !repeat) { held = true; continue; }
    // 优先级：限定区域且更深的 > 没限定区域的 > 兜底的；同级后挂载的优先。
    let depth = entry.options.fallback ? -1 : 0;
    if (area) for (let node: Element | null = area; node; node = node.parentElement) depth++;
    if (!best || depth > best.depth || (depth === best.depth && entry.order > best.entry.order)) best = { entry, index: match.index, depth };
  }
  return { best, held };
}

function onKeyDown(event: KeyboardEvent) {
  const { best, held } = pick(event);
  if (!best) { if (held) event.preventDefault(); return; }
  event.preventDefault();
  best.entry.run(event, best.index);
}

/** 挂在界面根部：跟随偏好里的快捷键设置，并安装唯一的按键监听。 */
export function useHotkeyDispatcher(next: HotkeySettings | undefined) {
  useEffect(() => { settings = next ?? {}; settingsStore.notify(); }, [next]);
  useEffect(() => {
    // 读到键盘布局后，符号键按布局上印的字重新显示。
    void loadKeyboardLayout().then(settingsStore.notify);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn, true);
    return () => { window.removeEventListener('keydown', onKeyDown); document.removeEventListener('focusin', onFocusIn, true); };
  }, []);
}

/** 注册一个命令的处理函数；index 是数字组合（# ）按下的第几个，从 0 开始。 */
export function useHotkey(id: string, handler: (event: KeyboardEvent, index?: number) => void, options: HotkeyOptions = {}) {
  const run = useEffectEvent(handler);
  const [order] = useState(() => ++sequence);
  const { enabled, within, inInput, dialog, repeat, onControl, fallback } = options;
  useEffect(() => {
    const entry: Entry = { id, order, run: (event, index) => run(event, index), options: { enabled, within, inInput, dialog, repeat, onControl, fallback } };
    entries.add(entry); registryStore.notify();
    return () => { entries.delete(entry); registryStore.notify(); };
  }, [id, order, enabled, within, inInput, dialog, repeat, onControl, fallback]);
}

/**
 * 这次按键会不会交给某条快捷键（与分发用同一套判断：区域、对话框、输入框等规则都算上）。组件自己处理的固定按键
 * （片段方向键微调、逐字编辑的方向键等）遇到它就让给快捷键，用户把命令改成这些组合时也不会被组件先吃掉。
 */
export function claimedByHotkey(event: KeyboardEvent): boolean {
  const { best, held } = pick(event);
  return !!best || held;
}

/** 设置页录制按键时暂停所有快捷键。 */
export function setHotkeyRecording(on: boolean) { recording = on; }

/** 打开速查浮层（设置页等处的按钮用；快捷键关闭时也能打开）。 */
export const openCheatsheet = () => window.dispatchEvent(new Event('workbench-open-cheatsheet'));

/** 跟随设置变化的按键文字（⌘⇧K / Ctrl+Shift+K），用于按钮提示；没有生效的按键时为空字符串。 */
export function useHotkeyText(id: string): string {
  useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot);
  const binding = activeBinding(id);
  return binding ? bindingText(binding, platform, hotkeyCommand.get(id)?.range) : '';
}

/** aria-keyshortcuts 的取值；没有生效的按键时为 undefined。 */
export function useHotkeyAria(id: string): string | undefined {
  useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot);
  const binding = activeBinding(id);
  return binding ? bindingAria(binding, platform) : undefined;
}

/** 当前有组件注册且可用的命令，速查浮层据此只列出此刻能用的快捷键。 */
export function useRegisteredHotkeys(): Set<string> {
  useSyncExternalStore(registryStore.subscribe, registryStore.snapshot);
  useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot);
  return new Set([...entries].filter(entry => entry.options.enabled !== false).map(entry => entry.id));
}

/** 两个按键是否会撞：完全相同，或一方是数字组合（# ）且另一方是范围内的同修饰键数字。 */
export function bindingsOverlap(a: string, b: string, rangeA = 9, rangeB = 9): boolean {
  if (!a || !b) return false;
  const split = (value: string) => { const parts = value.split('+'); return { key: parts.pop()!, mods: parts.join('+') }; };
  const x = split(a), y = split(b);
  if (x.mods !== y.mods) return false;
  if (x.key === y.key) return true;
  if (x.key === '#' && /^[1-9]$/.test(y.key)) return Number(y.key) <= rangeA;
  if (y.key === '#' && /^[1-9]$/.test(x.key)) return Number(x.key) <= rangeB;
  return false;
}

/**
 * 按键本身能不能给这条命令用：系统保留的不行；全局范围与在输入框里也生效的命令必须带 ⌘/Ctrl、⌃ 或 ⌥（Esc 例外），
 * 而且在 macOS 上只带 ⌥ 的字符组合不算（输入框里要用它打字符）。
 */
export function bindingProblem(id: string, binding: string): 'reserved' | 'modifier' | undefined {
  const command = hotkeyCommand.get(id);
  if (!command || !binding) return undefined;
  if (isReserved(binding, platform)) return 'reserved';
  if ((command.scope === 'global' || (command.modifier && binding !== 'esc')) && (!hasCommandModifier(binding) || typesCharacter(binding, platform))) return 'modifier';
  return undefined;
}

/**
 * 把 binding 用作 id 的按键时会撞上的全部命令：会同时生效的范围里的其他命令；固定条目也算（不能替换）。只在 macOS 上有的条目在其他平台不算。
 * 两条命令的默认按键本来就相同（例如时间线导出与音乐导出都是 ⌘E，靠焦点或当时的状态区分）、又都用着默认按键时不算冲突。
 */
export function findConflicts(current: HotkeySettings | undefined, id: string, binding: string): HotkeyCommand[] {
  const command = hotkeyCommand.get(id);
  if (!command || !binding) return [];
  const own = binding === defaultBinding(command);
  return hotkeyCommands.filter(other => other.id !== id && (!other.macOnly || platform === 'mac') && scopesMeet(other.scope, command.scope)
    && bindingFor(current, other).split('|').some(item => bindingsOverlap(item, binding, other.range, command.range) && !(own && bindingFor(undefined, other).split('|').includes(item))));
}

/** 按钮提示附上当前按键，写成“名称 (⌘E)”；按键被清除或快捷键关闭时返回 fallback（默认就是名称；按钮上已有文字时传 undefined 不显示提示）。 */
export function withHotkey(label: string, keys: string | undefined, fallback: string | undefined = label): string | undefined {
  return keys ? `${label} (${keys})` : fallback;
}
