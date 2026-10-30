import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { call, isDesktop } from '../shared/lib/client';
import { noticeMessage } from '../shared/lib/call-error';
import { readLocal, writeLocal } from '../shared/lib/local-store';
import { watchAssistantLive } from '../shared/lib/assistant-live';
import { takeAssistantFocus, trackAssistantFocus } from '../features/assistant/assistant-focus';
import { useAssistantNudge, type Nudge } from '../features/assistant/use-assistant-nudge';
import { assistantUsable, featureHidden, projectKind, type AssistantContext, type AssistantCue, type Draft, type State } from '../shared/workbench';
import type { DraftSession } from './use-draft-session';

// 助手（Ocho）与工作台的衔接：面板开关与入口、快捷键、助手发起的界面跳转与作品更新、发给助手的上下文与主动提示。
export function useAssistantBridge({ state, page, setPage, draft, setDraft, setDraftPersisted, saving, openSettings, selectDraft, cue, setError }: Pick<DraftSession, 'draft' | 'setDraft' | 'setDraftPersisted' | 'saving'> & {
  state: State; page: string; setPage: (page: string) => void; openSettings: (modelId?: string, requested?: string) => void; selectDraft: (item: Draft) => void; cue?: AssistantCue; setError: (message: string) => void;
}) {
  // 助手面板：开关与展开状态跨启动保留；⌘J/Ctrl+J、宿主标题栏按钮与编辑器 AI 写作栏都能打开。
  const [assistantOpen, setAssistantOpen] = useState(() => readLocal('yovoice-assistant-open') === 'true');
  const [assistantExpanded, setAssistantExpanded] = useState(() => readLocal('yovoice-assistant-expanded') === 'true');
  // 右下角入口与标题栏入口二选一：入口在时标题栏不重复显示，移走后才由标题栏接替；浮窗打开时两处入口都收起。
  const [launcherHidden, setLauncherHidden] = useState(() => readLocal('yovoice-assistant-launcher') === 'hidden');
  const showLauncher = (show: boolean) => {
    setLauncherHidden(!show);
    writeLocal('yovoice-assistant-launcher', show ? 'shown' : 'hidden');
  };
  useEffect(() => { writeLocal('yovoice-assistant-open', String(assistantOpen)); writeLocal('yovoice-assistant-expanded', String(assistantExpanded)); }, [assistantOpen, assistantExpanded]);
  // 在设置中隐藏 Ocho 后，浮窗、各处入口、快捷键与主动提示都不再出现。
  const assistantHidden = featureHidden(state.preferences, 'assistant');
  useEffect(() => {
    if (assistantHidden) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); setAssistantOpen(open => !open); }
    };
    const onToggle = () => setAssistantOpen(open => !open);
    window.addEventListener('keydown', onKey);
    window.addEventListener('workbench-toggle-assistant', onToggle);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('workbench-toggle-assistant', onToggle); };
  }, [assistantHidden]);
  // 编辑页的当前页面键（text/story/music/score），其余页面直接用页面名。
  const assistantPage = page === 'create' || page === 'history' ? projectKind(draft) : page === 'voices' ? 'voices' : page;
  const askAssistantPanel = { openWork: (workId: string) => { const target = state.drafts.find(item => item.id === workId); if (target) selectDraft(target); }, openSettings: () => openSettings(draft.modelId, 'ai') };
  // 助手要求界面跳转（open_work/open_page）与保存了正打开的作品，各消费一次；只订阅变化，流式输出时不重绘整个界面。
  const consumedNav = useRef<string | undefined>(undefined);
  const applyAssistantNav = useEffectEvent((nav: NonNullable<State['assistantLive']>['nav']) => {
    if (!nav) return;
    if (nav.workId) askAssistantPanel.openWork(nav.workId);
    else if (nav.page) setPage(nav.page);
  });
  // 助手保存了正打开的作品：本地没有未保存修改时，编辑器即时换上新内容。
  const consumedUpdate = useRef<string | undefined>(undefined);
  const applyAssistantUpdate = useEffectEvent((update: NonNullable<State['assistantLive']>['update']) => {
    if (!update) return;
    if (update.workId !== draft.id || page !== 'create' || saving || window.__workbenchDraft !== undefined) return;
    const fresh = state.drafts.find(item => item.id === update.workId);
    if (fresh) { setDraft(fresh); setDraftPersisted(true); }
  });
  // 新请求先记入状态，与同一次推送里的作品列表一起渲染后再处理，打开刚创建的作品时才能找到它。
  const [liveRequest, setLiveRequest] = useState<Pick<NonNullable<State['assistantLive']>, 'nav' | 'update'>>({});
  useEffect(() => watchAssistantLive(live => {
    const nav = live?.nav, update = live?.update;
    if (nav && nav.id !== consumedNav.current) { consumedNav.current = nav.id; setLiveRequest(current => ({ ...current, nav })); }
    if (update && update.id !== consumedUpdate.current) { consumedUpdate.current = update.id; setLiveRequest(current => ({ ...current, update })); }
  }), []);
  useEffect(() => applyAssistantNav(liveRequest.nav), [liveRequest.nav]);
  useEffect(() => applyAssistantUpdate(liveRequest.update), [liveRequest.update]);
  useEffect(() => { if (isDesktop) void call('assistant.entry', { visible: launcherHidden && !assistantOpen && !assistantHidden }).catch(() => undefined); }, [launcherHidden, assistantOpen, assistantHidden]);
  const assistantContext: AssistantContext = { page: assistantPage, workId: page === 'create' ? draft.id : '', workTitle: page === 'create' ? draft.title : '', workKind: page === 'create' ? projectKind(draft) : '', locale: state.preferences.uiLocale, cue };
  useEffect(() => trackAssistantFocus(), []);
  // 主动提示：面板关着、开着主动提示且助手可用时，生成或下载结束会在右下角冒出建议。
  const assistantReady = !state.assistantMissing && assistantUsable(state.aiProviders?.find(item => item.id === state.aiProviderID));
  const [nudge, dismissNudge] = useAssistantNudge(state, assistantReady && !assistantHidden && !assistantOpen && !state.preferences.assistantQuiet);
  const actOnNudge = (next: Nudge) => {
    dismissNudge();
    setAssistantOpen(true);
    void call('assistant.send', { text: next.prompt, context: { ...assistantContext, page: assistantContext.page === 'create' ? 'text' : assistantContext.page, ...takeAssistantFocus() } }).catch(e => setError(noticeMessage(e)));
  };
  return { assistantOpen, setAssistantOpen, assistantExpanded, setAssistantExpanded, launcherHidden, showLauncher, assistantHidden, assistantPage, askAssistantPanel, assistantContext, nudge, dismissNudge, actOnNudge };
}
