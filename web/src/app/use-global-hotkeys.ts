import { call } from '../shared/lib/client';
import { useHotkey } from '../shared/hotkeys/hotkeys';
import { featureHidden, type Preferences } from '../shared/workbench';

// 全局快捷键：切换页面、打开设置、开关侧栏与检查器、取消正在进行的任务。
// 随页面变化的命令（新建、返回、取消录音等）由各页面再注册一次，后挂载或限定区域的注册优先。
export function useGlobalHotkeys({ page, setPage, openSettings, toggleSidebar, toggleInspector, inspectorAvailable, toggleAssistant, assistantHidden, busy, preferences }: {
  page: string; setPage: (page: string) => void; openSettings: (modelId?: string, tab?: string) => void;
  toggleSidebar: () => void; toggleInspector: () => void; inspectorAvailable: boolean;
  toggleAssistant: () => void; assistantHidden: boolean; busy: boolean; preferences: Preferences;
}) {
  useHotkey('global.page.text', () => setPage('text'));
  useHotkey('global.page.transcribe', () => setPage('transcribe'), { enabled: !featureHidden(preferences, 'transcribe') });
  useHotkey('global.page.story', () => setPage('story'), { enabled: !featureHidden(preferences, 'story') });
  useHotkey('global.page.music', () => setPage('music'), { enabled: !featureHidden(preferences, 'music') });
  useHotkey('global.page.voices', () => setPage('characters'));
  useHotkey('global.settings', () => openSettings(undefined, 'general'));
  // 版本记录回到作品；转写编辑页回到列表由转写页自己注册。
  useHotkey('global.back', () => setPage('create'), { enabled: page === 'history' });
  useHotkey('global.nextTab', () => switchTab(1));
  useHotkey('global.prevTab', () => switchTab(-1));
  // 模态对话框打开时 Ocho 会落在它下面、点不到，所以和其他全局命令一样让给对话框。
  useHotkey('global.assistant', toggleAssistant, { enabled: !assistantHidden });
  useHotkey('global.sidebar', toggleSidebar);
  useHotkey('global.inspector', toggleInspector, { enabled: inspectorAvailable });
  useHotkey('global.cancel', () => { void call('operation.cancel').catch(() => undefined); }, { enabled: busy });
}

/** 在当前页面可见的第一组标签之间切换（设置页的分类、音乐与编曲、声音与参考音频等）。 */
function switchTab(step: number) {
  const list = Array.from(document.querySelectorAll<HTMLElement>('.page-panel [role="tablist"]')).find(element => element.getClientRects().length > 0);
  const tabs = Array.from(list?.querySelectorAll<HTMLElement>('[role="tab"]:not([aria-disabled="true"]):not([disabled])') ?? []);
  if (tabs.length < 2) return;
  const current = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  const next = tabs[(current + step + tabs.length) % tabs.length];
  next.click();
  next.focus();
}
