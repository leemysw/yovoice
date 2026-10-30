import { emptyState, type State } from '../../workbench';
import { isUiLocale } from '../../i18n/locale';

// 浏览器预览的本地后端：只保存编辑和音频数据，不模拟桌面推理或模型安装。
// 作品状态存于 localStorage（主副本加恢复备份），音频存于 IndexedDB。
const primaryKey = 'voice-workbench-v1';
const backupKey = 'voice-workbench-backup';

const listeners = new Set<(state: State) => void>();
let stored: State | undefined;

function load(): State {
  let state = emptyState();
  for (const key of [primaryKey, backupKey]) {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (!value || !Array.isArray(value.drafts) || !Array.isArray(value.history) || !Array.isArray(value.voices)) continue;
      state = value; break;
    } catch { /* 主副本损坏时继续读取恢复备份。 */ }
  }
  state.characters ??= []; state.previews = []; delete state.aiTask; delete state.melody; state.assistantLive = undefined;
  // 浏览器预览默认跳过首次启动的开场画面和功能引导；需要查看时在状态里把 introSeen / tourSeen 设为 false。
  state.preferences = { ...state.preferences, introSeen: state.preferences?.introSeen ?? true, tourSeen: state.preferences?.tourSeen ?? true };
  if (!isUiLocale(state.preferences?.uiLocale)) {
    state = { ...state, preferences: { ...state.preferences, uiLocale: 'zh-CN' } };
  }
  return state;
}

// 首次使用时才读取本地存储，桌面端不会触碰预览数据。
export const preview = () => stored ??= load();

// 写回 localStorage（先把上一份完好的主副本转为恢复备份），再把状态副本推给所有订阅者。
export function publish() {
  const previous = localStorage.getItem(primaryKey);
  if (previous) { try { JSON.parse(previous); localStorage.setItem(backupKey, previous); } catch { /* 损坏的主副本不覆盖恢复备份。 */ } }
  localStorage.setItem(primaryKey, JSON.stringify(preview()));
  listeners.forEach(fn => fn(structuredClone(preview())));
}

export function subscribePreview(listener: (state: State) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
