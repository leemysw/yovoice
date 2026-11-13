import type { HotkeySettings } from '../workbench';
import { hotkeyCommand, hotkeyCommands, hotkeyTree } from './commands';
import { bindingFor, bindingProblem, defaultBinding, findConflicts, platform } from './hotkeys';
import { canonicalBinding, normalizeBinding, type Platform } from './keys';

// 快捷键设置的导入导出：文件是一份 JSON，只认命令 id，不认本机版本没有的命令（导入时跳过）。

export const hotkeyFileFormat = 'yovoice-hotkeys';
export interface HotkeyFile {
  format: typeof hotkeyFileFormat;
  version: 1;
  platform: Platform;
  disabled?: boolean;
  off?: string[];
  bindings: Record<string, string>;
}

/** 去掉与默认相同的部分；全部默认时返回 undefined，保存时不写入。 */
export function compactHotkeys(settings: HotkeySettings): HotkeySettings | undefined {
  const bindings = Object.fromEntries(Object.entries(settings.bindings ?? {}).filter(([id, binding]) => {
    const command = hotkeyCommand.get(id);
    return !command || normalizeBinding(binding, platform) !== defaultBinding(command);
  }));
  const result: HotkeySettings = {};
  if (settings.disabled) result.disabled = true;
  if (settings.off?.length) result.off = [...new Set(settings.off)];
  if (Object.keys(bindings).length) result.bindings = bindings;
  return Object.keys(result).length ? result : undefined;
}

/** 导出：all 为 false 时只写改过的按键；switches 为 true 时带上总开关与各功能区开关。 */
export function exportHotkeys(settings: HotkeySettings | undefined, { all, switches }: { all: boolean; switches: boolean }): string {
  const bindings: Record<string, string> = {};
  for (const command of hotkeyCommands) {
    if (command.fixed) continue;
    if (all || settings?.bindings?.[command.id] !== undefined) bindings[command.id] = bindingFor(settings, command);
  }
  const file: HotkeyFile = { format: hotkeyFileFormat, version: 1, platform, bindings };
  if (switches) { file.disabled = !!settings?.disabled; file.off = settings?.off ?? []; }
  return JSON.stringify(file, null, 2) + '\n';
}

/** 读取导入的文件；格式不对时返回 null。 */
export function parseHotkeys(text: string): HotkeyFile | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const file = value as Partial<HotkeyFile>;
  if (file.format !== hotkeyFileFormat || file.version !== 1 || !file.bindings || typeof file.bindings !== 'object' || Array.isArray(file.bindings)) return null;
  if (file.disabled !== undefined && typeof file.disabled !== 'boolean') return null;
  if (file.off !== undefined && (!Array.isArray(file.off) || file.off.some(area => typeof area !== 'string'))) return null;
  if (Object.values(file.bindings).some(binding => typeof binding !== 'string')) return null;
  return { format: hotkeyFileFormat, version: 1, platform: file.platform === 'mac' ? 'mac' : 'other', disabled: file.disabled, off: file.off, bindings: file.bindings };
}

export type ImportMode = 'merge' | 'replace';
export interface ImportChange {
  id: string;
  before: string;
  after: string;
  /** import：文件里的按键；conflict：与导入的按键冲突而被清除；reset：替换模式下文件里没有、恢复默认。 */
  reason: 'import' | 'conflict' | 'reset';
  /** 冲突时是哪条导入的命令占用了它。 */
  by?: string;
  /** 原来是自己改过的按键，会被覆盖。 */
  overridden?: boolean;
}
export interface ImportPlan {
  next: HotkeySettings | undefined;
  changes: ImportChange[];
  /** 本机版本没有的命令、写法不对或不能使用的按键。 */
  skipped: string[];
  switchesChanged: boolean;
}

/** 算出导入后的设置与逐条变化：merge 只改文件里有的命令，replace 让文件里没有的命令恢复默认。导入的按键与其他命令冲突时，清除对方。 */
export function planImport(current: HotkeySettings | undefined, file: HotkeyFile, mode: ImportMode): ImportPlan {
  const areas = new Set(hotkeyTree.map(area => area.id));
  const working: HotkeySettings = { bindings: mode === 'merge' ? { ...current?.bindings } : {} };
  const imported = new Set<string>();
  const skipped: string[] = [];
  const clearedBy = new Map<string, string>();
  for (const [id, raw] of Object.entries(file.bindings)) {
    const command = hotkeyCommand.get(id);
    // 先按导出方的平台整理（Windows / Linux 的 ctrl 即 mod），再换成本机的写法；键名不认识、或数字组合（# ）与命令不对应时跳过。
    const source = command ? canonicalBinding(raw, file.platform) : null;
    if (!command || command.fixed || source === null || (source.endsWith('#') !== !!command.range)) { skipped.push(id); continue; }
    // 文件来自另一个平台、写的正是那边的默认按键（Windows 的 Ctrl+Shift+. 之于 macOS 的 ⌘.）：按默认处理，不算改过。
    if (file.platform !== platform && source && source === defaultBinding(command, file.platform)) {
      delete working.bindings![id]; imported.add(id); continue;
    }
    const binding = normalizeBinding(source, platform);
    if (bindingProblem(id, binding)) { skipped.push(id); continue; }
    const conflicts = findConflicts(working, id, binding);
    // 撞上固定按键或本次已导入的命令时，这一条不导入；撞上其他命令时把它们都清除。
    if (conflicts.some(conflict => conflict.fixed || imported.has(conflict.id))) { skipped.push(id); continue; }
    for (const conflict of conflicts) { working.bindings![conflict.id] = ''; clearedBy.set(conflict.id, id); }
    working.bindings![id] = binding;
    imported.add(id);
  }
  // 清除对方之后，对方如果又是本次导入的，以导入的为准。
  for (const id of imported) clearedBy.delete(id);
  const hasSwitches = file.disabled !== undefined || file.off !== undefined;
  if (hasSwitches || mode === 'replace') {
    working.disabled = file.disabled ?? (mode === 'merge' ? current?.disabled : false);
    working.off = file.off ? file.off.filter(area => areas.has(area)) : mode === 'merge' ? current?.off : [];
  } else {
    working.disabled = current?.disabled;
    working.off = current?.off;
  }
  const next = compactHotkeys(working);
  const changes: ImportChange[] = [];
  for (const command of hotkeyCommands) {
    if (command.fixed) continue;
    const before = bindingFor(current, command), after = bindingFor(next, command);
    if (before === after) continue;
    const reason = imported.has(command.id) ? 'import' : clearedBy.has(command.id) ? 'conflict' : 'reset';
    changes.push({ id: command.id, before, after, reason, by: clearedBy.get(command.id), overridden: reason === 'import' && current?.bindings?.[command.id] !== undefined });
  }
  const switchesChanged = !!current?.disabled !== !!next?.disabled || [...(current?.off ?? [])].sort().join() !== [...(next?.off ?? [])].sort().join();
  return { next, changes, skipped, switchesChanged };
}
