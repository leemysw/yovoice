import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { useResizable } from '@astryxdesign/core/Resizable';
import { AppShell } from '@astryxdesign/core/AppShell';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack, Layout } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { PanelLeft, PanelRight, Check, Disc3, FolderOpen, History, Plus, LoaderCircle, MoreHorizontal, Save } from 'lucide-react';
import { NewProject, Projects } from '../features/library/projects';
import { BookImport } from '../features/library/book-import';
import { VoiceTarget } from '../features/library/voice-target';
import { MediaLibrary } from '../features/library/media-library';
import { CharacterEditor, CharacterLibrary } from '../features/library/characters';
import { VoiceEditor } from '../features/library/voice-editor';
import { Studio } from '../features/create/studio';
import { SubtitleImport, SubtitleEditor, SpeakerAvatar } from '../features/create/subtitles';
import { Inspector } from '../features/create/inspector';
import { MusicEditor } from '../features/music/music-editor';
import { MusicInspector } from '../features/music/music-inspector';
import { NowPlaying } from '../features/music/now-playing';
import { musicModelId } from '../features/music/music-draft';
import { soundFontId } from '../features/score/score-draft';
import { ScoreEditor } from '../features/score/score-editor';
import { ScoreDock } from '../features/score/score-arrangement';
import { ScoreInspector } from '../features/score/score-inspector';
import { SfxEditor } from '../features/sfx/sfx-editor';
import { sfxModelId } from '../features/sfx/sfx-draft';
import { SelectionAction, type TextSelection } from '../features/create/selection-action';
import { Timeline } from '../features/media/timeline';
import { TimelineEditor } from '../features/media/timeline-editor';
import { Player } from '../features/media/player';
import { Selector } from '../shared/selector';
import { ConfirmDelete } from '../shared/ui/app-dialog';
import { call, exportOutput, isDesktop } from '../shared/lib/client';
import { noticeMessage } from '../shared/lib/call-error';
import { dismissSplash } from '../shared/lib/splash';
import { IntroScreen } from './intro-screen';
import { GuideTour } from './guide-tour';
import { formatNotice } from '../shared/i18n/format';
import { isAligner, isIndexModel, isYuE, modelEngineReady, runtimeStatus, runtimeUsable, requiresVoice, projectKind, createDraft, synthesisSettings, performanceSettings, cueSettings, type Character, type Draft, type EngineInfo, type State, type ModelPackage, type Voice, type Generation, type Track, type AssistantContext, modelTab, preferredModel, featureHidden, assistantUsable, newId } from '../shared/workbench';
// 助手（含形象与点阵动画）首屏后再加载，不占主包。
const AssistantDock = lazy(() => import('../features/assistant/assistant-dock').then(module => ({ default: module.AssistantDock })));
const AssistantTitleButton = lazy(() => import('../features/assistant/assistant-dock').then(module => ({ default: module.AssistantTitleButton })));
import { quickActions } from '../features/assistant/assistant-launch';
import { reportPlayhead, takeAssistantFocus, trackAssistantFocus } from '../features/assistant/assistant-focus';
import { useAssistantNudge, type Nudge } from '../features/assistant/assistant-nudge';
import { SidebarNav } from './sidebar-nav';
import { PageBoundary } from '../shared/ui/page-boundary';
import { Notifications } from './notifications';
import { UpdateDialogHost } from '../features/update/update-dialog';
import { UpdateNotice } from '../features/update/update-notice';
import { PronunciationDialog, type Pronunciation } from './pronunciation-dialog';
import type { DraftSession } from './use-draft-session';
import { watchAssistantLive } from '../shared/lib/assistant-live';
import { AudioCheckBadge } from '../features/media/audio-check';
import { readLocal, writeLocal } from '../shared/lib/local-store';
const Settings = lazy(() => import('../features/settings/settings').then(module => ({ default: module.Settings })));
const VoicePicker = lazy(() => import('../features/media/voice-picker').then(module => ({ default: module.VoicePicker })));

// 工作台界面：导航、页面切换与各页面之间的协作；作品保存由 useDraftSession 负责。
export function WorkbenchChrome({ state, catalog, catalogRevision, engine, ready, session, error, setError }: { state: State; catalog: ModelPackage[]; catalogRevision: string; engine: EngineInfo; ready: boolean; session: DraftSession; error: string; setError: (message: string) => void }) {
  const t = useTranslator();
  const { draft, setDraft, draftPersisted, setDraftPersisted, saving, saveFailed, change, persistDraft, setActive, deleteTarget, setDeleteTarget, deleting, deleteError, deleteDraft } = session;
  const navigation = useResizable({ defaultSize: 224, minSize: 180, maxSize: 360, collapsible: true, autoSaveId: 'workbench-sidebar' });
  const { isCollapsed, expand, collapse } = navigation;
  const toggleSidebar = useCallback(() => { if (isCollapsed) expand(); else collapse(); }, [isCollapsed, expand, collapse]);
  useEffect(() => {
    window.addEventListener('workbench-toggle-sidebar', toggleSidebar);
    return () => window.removeEventListener('workbench-toggle-sidebar', toggleSidebar);
  }, [toggleSidebar]);
  const previousVoices = useRef<Voice[]>([]);
  const [page, setPage] = useState(() => {
    if (isDesktop) {
      const saved = readLocal('yovoice-active-page');
      const listPages = ['text', 'story', 'music', 'score', 'sfx', 'characters', 'settings'];
      return saved && listPages.includes(saved) ? saved : 'text';
    }
    return 'create';
  });
  useEffect(() => {
    writeLocal('yovoice-active-page', page);
  }, [page]);
  // 页面第一次打开时才挂载，之后保持挂载（切走只隐藏），切回来时保留编辑、滚动与播放状态；启动时只渲染当前页。
  const [visited, setVisited] = useState(() => new Set([page]));
  if (!visited.has(page)) setVisited(new Set(visited).add(page));
  // 作品只在编辑页和版本记录页处于打开状态。
  useEffect(() => setActive(page === 'create' || page === 'history'), [page, setActive]);
  const [settingsFocus, setSettingsFocus] = useState<{ tab: string; modelId: string; request: number } | undefined>();
  // 缺的是音色库时打开独立的音色库页，其余模型在“模型”页。
  const openSettings = (modelId = draft.modelId, requested = 'models') => { const family = catalog.find(m => m.id === modelId)?.family; const tab = requested === 'models' && family ? modelTab(family) : requested; setSettingsFocus({ tab, modelId, request: performance.now() }); setPage('settings'); };
  const [voicePicker, setVoicePicker] = useState<'voice' | 'emotion' | 'add' | null>(null);
  const [previewTrack, setPreviewTrack] = useState<Track | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  // 编曲视图与底部播放器共用播放位置：播放器上报进度，点标尺发出跳转请求。
  const [playback, setPlayback] = useState({ time: 0, playing: false }); const [seekRequest, setSeekRequest] = useState<{ time: number; nonce: number }>(); const [advanced, setAdvanced] = useState(false);
  const [pronunciation, setPronunciation] = useState<Pronunciation | null>(null);
  const [showInspector, setShowInspector] = useState(false);
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
    if (update.workId !== draft.id || page !== 'create' || session.saving || window.__workbenchDraft !== undefined) return;
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

  // 宽屏下右侧检查器的收起状态，跨作品、跨启动保留。
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => readLocal('workbench-inspector-collapsed') === '1');
  const toggleInspector = useCallback(() => setInspectorCollapsed(current => {
    const next = !current;
    writeLocal('workbench-inspector-collapsed', next ? '1' : '0');
    return next;
  }), []);
  // 窗口右上角的右侧面板开关：创作区较窄时检查器已自动收起（见 styles.css 的 studio 容器查询），开关改为展开或收回检查器。
  const toggleInspectorPanel = useCallback(() => {
    // 角色编辑器离开后只隐藏不卸载，它的 .studio 宽度为 0，需取当前可见的创作区。
    const studio = Array.from(document.querySelectorAll<HTMLElement>('.studio')).find(element => element.clientWidth > 0);
    if (studio && studio.clientWidth <= 860) setShowInspector(current => !current);
    else toggleInspector();
  }, [toggleInspector]);
  useEffect(() => {
    // 只有工作区有右侧面板；列表、设置等页面忽略开关，不跳回上次的作品。
    const handleToggle = () => { if (page === 'create') toggleInspectorPanel(); };
    window.addEventListener('workbench-toggle-inspector', handleToggle);
    return () => window.removeEventListener('workbench-toggle-inspector', handleToggle);
  }, [page, toggleInspectorPanel]);
  // 标题栏的右侧面板开关由宿主绘制：离开工作区时让宿主隐藏它。
  useEffect(() => { if (isDesktop) void call('inspector.available', { available: page === 'create' }).catch(() => undefined); }, [page]);
  useEffect(() => { if (isDesktop) void call('assistant.entry', { visible: launcherHidden && !assistantOpen && !assistantHidden }).catch(() => undefined); }, [launcherHidden, assistantOpen, assistantHidden]);
  const editor = useRef<HTMLTextAreaElement>(null); const previousHistory = useRef<string | undefined>(undefined); const knownHistory = useRef(new Set<string>());
  const onError = useCallback((message: string) => setError(message), [setError]);
  useEffect(() => {
    if (!isDesktop) return;
    const saved = readLocal('astryx-resizable:workbench-sidebar');
    if (saved) void call('sidebar.save', JSON.parse(saved)).catch(error => setError(noticeMessage(error)));
  }, [navigation.size, navigation.isCollapsed, setError]);
  const run = useCallback((action: () => Promise<unknown>) => { void action().catch(e => setError(noticeMessage(e))); }, [setError]);
  useEffect(() => {
    if (!ready) return;
    const removed = previousVoices.current.filter(v => !state.voices.some(next => next.id === v.id));
    previousVoices.current = state.voices;
    setDraft(current => {
      const voiceId = removed.some(v => v.id === current.voiceId) ? null : current.voiceId;
      const emotionVoiceId = removed.some(v => v.id === current.emotionVoiceId) ? null : current.emotionVoiceId;
      return voiceId === current.voiceId && emotionVoiceId === current.emotionVoiceId ? current : { ...current, voiceId, emotionVoiceId };
    });
    const refresh = (current: Track | null) => {
      if (!current) return null;
      const item = current.kind === 'voices' ? state.voices.find(v => v.id === current.id) : state.history.find(v => v.id === current.id);
      return item ? { ...current, name: 'name' in item ? item.name : item.title } : null;
    };
    setTrack(refresh); setPreviewTrack(refresh);
  }, [state.voices, state.history, ready, setDraft]);
  useEffect(() => { setPreviewTrack(null); setTrack(current => current ? { ...current, playRequest: undefined } : null); }, [page]);
  // 界面就绪或加载出错时收起启动动画，出错时要让错误提示露出来。
  // 首次启动在界面就绪后显示开场画面；点击「开始探索」后记入偏好，以后只显示简短的加载动画。
  // 设置里的「重新播放」只当场再看一次，不改动已保存的偏好。
  const [introDone, setIntroDone] = useState(false);
  const [introReplay, setIntroReplay] = useState(false);
  useEffect(() => {
    const replay = () => setIntroReplay(true);
    window.addEventListener('workbench-show-intro', replay);
    return () => window.removeEventListener('workbench-show-intro', replay);
  }, []);
  const showIntro = ready && !error && ((!state.preferences.introSeen && !introDone) || introReplay);
  const finishIntro = () => {
    setIntroReplay(false);
    if (state.preferences.introSeen || introDone) return;
    setIntroDone(true);
    void call('preferences.save', { ...state.preferences, introSeen: true }).catch(e => setError(noticeMessage(e)));
  };
  // 功能引导紧接开场画面出现，看完或跳过后记入偏好；设置里的「重新查看」只当场再看一次。
  const [tourDone, setTourDone] = useState(false);
  const [tourReplay, setTourReplay] = useState(false);
  useEffect(() => {
    const replay = () => setTourReplay(true);
    window.addEventListener('workbench-show-tour', replay);
    return () => window.removeEventListener('workbench-show-tour', replay);
  }, []);
  const showTour = ready && !error && !showIntro && ((!state.preferences.tourSeen && !tourDone) || tourReplay);
  // 引导高亮侧栏入口，侧栏收起时先展开。
  useEffect(() => { if (showTour && isCollapsed) expand(); }, [showTour, isCollapsed, expand]);
  const finishTour = () => {
    setTourReplay(false);
    if (state.preferences.tourSeen || tourDone) return;
    setTourDone(true);
    // 开场画面刚保存的 introSeen 可能还没回到状态里，一并带上，避免被覆盖。
    void call('preferences.save', { ...state.preferences, introSeen: state.preferences.introSeen || introDone, tourSeen: true }).catch(e => setError(noticeMessage(e)));
  };
  // 界面就绪或加载出错时收起启动动画，出错时要让错误提示露出来；开场画面与启动动画同一造型，直接接续。
  useEffect(() => { if (error || showIntro) dismissSplash(true); else if (ready) dismissSplash(); }, [ready, error, showIntro]);
  useEffect(() => { if (ready) setDraft(current => Timeline.accept(current, state.history)); }, [state.history, draft.id, ready, setDraft]);
  const generate = () => {
    if (state.activity?.status === 'running') return;
    // 还没准备好时：缺参考音频直接打开声音选择，缺模型或推理引擎跳到设置里对应的页面。
    if (draft.subtitles) {
      const missing = draft.subtitles.speakers.map(s => ({ ...draft, ...s.settings })).find(d => !state.models.some(m => m.id === d.modelId));
      if (missing || !runtimeUsable(runtimeStatus(state, engine))) { openSettings(missing?.modelId ?? draft.modelId, missing ? 'models' : 'engine'); return; }
      run(async () => { await persistDraft(draft); await call('generation.start', draft); }); return;
    }
    // 编曲只需要音色库，不经过推理引擎。
    if (projectKind(draft) === 'score') {
      if (!state.models.some(m => m.id === draft.modelId)) { openSettings(draft.modelId, 'models'); return; }
      run(async () => { await persistDraft(draft); await call('generation.start', draft); }); return;
    }
    if (requiresVoice(draft) &&!state.voices.some(voice => voice.id === draft.voiceId)) { setVoicePicker('voice'); return; }
    if (!runtimeUsable(runtimeStatus(state, engine)) || !state.models.some(m => m.id === draft.modelId) || !modelEngineReady(state, catalog.find(m => m.id === draft.modelId))) {
      openSettings(draft.modelId, !state.models.some(m => m.id === draft.modelId) ? 'models' : 'engine'); return;
    }
    run(async () => { await persistDraft(draft); await call('generation.start', draft); });
  };
  // Ctrl/⌘+Enter 在创作页生成，对话框或角色编辑器打开时不响应。
  const generateShortcut = useEffectEvent((event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && page === 'create' && !Array.from(document.querySelectorAll('[role=dialog], [data-character-active=true]')).some(e => e.getClientRects().length > 0)) { event.preventDefault(); generate(); } });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => generateShortcut(event);
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  async function newDraft(next: Draft) {
    if (draftPersisted) await persistDraft(draft); await persistDraft(next);
    setDraft(next); setPage('create');
  }
  // 整本书导入的多个章节作品：倒序保存让第一章排在最前，最后打开第一章。
  async function importBook(drafts: Draft[]) {
    for (const item of drafts.slice(1).reverse()) await call('draft.save', item);
    await newDraft(drafts[0]);
  }
  function selectDraft(item: Draft) { run(async () => { if (draftPersisted) await persistDraft(draft); setDraft(item.id === draft.id ? draft : item); setDraftPersisted(true); setPage('create'); }); }
  function selectVoice(voice: Voice) { if (voicePicker !== 'add') change(voicePicker === 'emotion' ? { emotionVoiceId: voice.id } : { voiceId: voice.id, referenceText: voice.referenceText ?? '' }); setVoicePicker(null); }
  function annotate(selection: TextSelection) {
    setPronunciation({ ...selection, sound: '' });
  }
  const generations = state.history.filter(item => item.settings.id === draft.id);
  const activity = state.activity; const busy = activity?.status === 'running';
  const [playingCue, setPlayingCue] = useState(-1);
  const [cueSelection, setCueSelection] = useState<{ draftId: string; index: number; revision: number } | null>(null);
  const selectedCue = cueSelection?.draftId === draft.id ? Math.min(cueSelection.index, (draft.subtitles?.cues.length ?? 1) - 1) : 0;
  // 故事配音里选中的台词随上下文带上，Ocho 据此理解“这句”。
  const focusCue = page === 'create' && draft.subtitles?.cues.length ? (() => {
    const cue = draft.subtitles.cues[selectedCue];
    return { index: selectedCue + 1, total: draft.subtitles.cues.length, speaker: draft.subtitles.speakers.find(item => item.id === cue.speakerId)?.sourceName, text: cue.text };
  })() : undefined;
  const assistantContext: AssistantContext = { page: assistantPage, workId: page === 'create' ? draft.id : '', workTitle: page === 'create' ? draft.title : '', workKind: page === 'create' ? projectKind(draft) : '', locale: state.preferences.uiLocale, cue: focusCue };
  useEffect(() => trackAssistantFocus(), []);
  // 主动提示：面板关着、开着主动提示且助手可用时，生成或下载结束会在右下角冒出建议。
  const assistantReady = !state.assistantMissing && assistantUsable(state.aiProviders?.find(item => item.id === state.aiProviderID));
  const [nudge, dismissNudge] = useAssistantNudge(state, assistantReady && !assistantHidden && !assistantOpen && !state.preferences.assistantQuiet);
  const actOnNudge = (next: Nudge) => {
    dismissNudge();
    setAssistantOpen(true);
    void call('assistant.send', { text: next.prompt, context: { ...assistantContext, page: assistantContext.page === 'create' ? 'text' : assistantContext.page, ...takeAssistantFocus() } }).catch(() => undefined);
  };
  const activeCue = draft.subtitles?.cues[selectedCue];
  const activeSpeaker = draft.subtitles?.speakers.find(speaker => speaker.id === activeCue?.speakerId) ?? draft.subtitles?.speakers[0];
  const inspectorDraft = activeSpeaker ? { ...draft, ...(activeCue ? cueSettings(draft, activeCue) : activeSpeaker.settings), text: activeCue?.text ?? '' } : draft;
  const selectCue = (index: number) => setCueSelection(current => ({ draftId: draft.id, index, revision: (current?.revision ?? 0) + 1 }));
  // 已选演绎只修改当前句子的快照，默认参数仍归当前说话人。
  const changeSpeaker = (patch: Partial<Draft>) => { setDraftPersisted(true); setDraft(current => {
    if (!activeSpeaker || !current.subtitles || current.id !== draft.id) return { ...current, ...patch, performance: current.performance ? { ...current.performance, settings: synthesisSettings({ ...current, ...patch }) } : undefined };
    const { text, ...settings } = patch;
    if (activeCue?.performance) {
      const cues = current.subtitles.cues.map((cue, index) => index === selectedCue ? { ...cue, text: text ?? cue.text, performance: { ...cue.performance!, settings: performanceSettings(activeSpeaker.settings ?? synthesisSettings(current), { ...cue.performance!, settings: { ...cueSettings(current, cue), ...settings } }) } } : cue);
      const joined = cues.map(c => c.text).join('\n');
      return joined.length > 12000 ? current : { ...current, text: joined, subtitles: { ...current.subtitles, cues } };
    }
    const cues = current.subtitles.cues.map((cue, index) => index === selectedCue && text !== undefined ? { ...cue, text } : cue);
    const joined = cues.map(cue => cue.text).join('\n');
    if (joined.length > 12000) return current;
    return { ...current, text: joined, subtitles: { ...current.subtitles, cues, speakers: current.subtitles.speakers.map(speaker => speaker.id === activeSpeaker.id && Object.keys(settings).length ? { ...speaker, settings: synthesisSettings({ ...current, ...speaker.settings, ...settings }) } : speaker) } };
  }); };
  const [voiceTarget, setVoiceTarget] = useState<Character | null>(null);
  const projectList = state.drafts.map(d => d.id === draft.id ? { ...draft, createdAt: d.createdAt, updatedAt: d.updatedAt } : d);
  const [voiceQuery, setVoiceQuery] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const openHistory = (item: Draft) => run(async () => { if (draftPersisted) await persistDraft(draft); setDraft(item); setDraftPersisted(true); setHistoryQuery(''); setPreviewTrack(null); setPage('history'); });
  const [characterEditor, setCharacterEditor] = useState<Character | null>(null);
  const characterActive = !!characterEditor && page === 'characters';
  const characterReturnPage = useRef('create');
  const characterOrigin = useRef<{ draftId: string; speakerId: string } | null>(null);
  const [voiceEditor, setVoiceEditor] = useState<Voice | Generation | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Generation | null>(null);
  const selectedCharacter = draft.characterId ?? null;
  const applyCharacter = (c: Character) => {
    if (activeSpeaker) {
      setDraft(current => ({ ...current, subtitles: { ...current.subtitles!, cues: current.subtitles!.cues.map(cue => cue.speakerId === activeSpeaker.id ? { ...cue, performance: undefined } : cue), speakers: current.subtitles!.speakers.map(s => s.id === activeSpeaker.id ? { ...s, characterId: c.id, settings: structuredClone(c.settings) } : s) } }));
    } else { change({ ...c.settings, characterId: c.id, performance: undefined }); }
  };
  const editCharacter = (character: Character) => { if (characterEditor) { setPage('characters'); return; } characterOrigin.current = page === 'create' ? { draftId: draft.id, speakerId: activeSpeaker?.id ?? '' } : null; characterReturnPage.current = page; setCharacterEditor(character); setPage('characters'); };
  const openCharacter = () => {
    editCharacter({ id: newId(), name: activeSpeaker?.sourceName || draft.title, settings: synthesisSettings(inspectorDraft), demoText: t('@yovoice.character.example') });
  };
  // 把一条生成结果用到的声音设置存为角色：模型、参考音色、声音设计描述和全部参数一起带上，在角色编辑器里确认后保存。
  const characterFromGeneration = (item: Generation) => editCharacter({ id: newId(), name: item.title, settings: structuredClone(synthesisSettings(item.settings)), demoText: item.settings.text.slice(0, 120) || t('@yovoice.character.example') });
  const createVoice = () => {
    const defaults = createDraft(false, state.preferences.uiLocale);
    editCharacter({ id: newId(), name: t('@yovoice.library.newVoice'), settings: synthesisSettings({ ...defaults, modelId: state.models.find(m => m.id.startsWith('omnivoice-'))?.id ?? 'omnivoice-q8', voiceMode: 'design' }), demoText: t('@yovoice.character.example') });
  };
  async function applyToTarget(voice: Character, draftId: string, speakerId: string) {
    const source = draftId === 'new' ? { ...createDraft(false, state.preferences.uiLocale), kind: 'text' as const } : projectList.find(d => d.id === draftId);
    if (!source || (source.subtitles && !source.subtitles.speakers.some(s => s.id === speakerId))) throw new Error('@yovoice.error.draftIDInvalid');
    const next = source.subtitles ? { ...source, subtitles: { ...source.subtitles, cues: source.subtitles.cues.map(cue => cue.speakerId === speakerId ? { ...cue, performance: undefined } : cue), speakers: source.subtitles.speakers.map(s => s.id === speakerId ? { ...s, characterId: voice.id, settings: structuredClone(voice.settings) } : s) } } : { ...source, ...structuredClone(voice.settings), characterId: voice.id, performance: undefined };
    if (draftId === draft.id) { await persistDraft(next); setDraft(next); setPage('create'); }
    else await newDraft(next);
    if (next.subtitles) setCueSelection(current => ({ draftId: next.id, index: Math.max(0, next.subtitles!.cues.findIndex(c => c.speakerId === speakerId)), revision: (current?.revision ?? 0) + 1 }));
  }
  const libraryTabs = <TabList value={page === 'voices' ? 'voices' : 'characters'} onChange={setPage} role="tablist" hasDivider>
    <Tab value="characters" label={t('@yovoice.library.voicesTab')} panelId="voice-library-panel" />
    <Tab value="voices" label={t('@yovoice.library.referencesTab')} panelId="reference-library-panel" />
  </TabList>;
  // 音乐生成页内用标签切换「歌曲」「编曲」与「音效」三类作品。
  const musicTabs = <TabList value={page === 'score' || page === 'sfx' ? page : 'music'} onChange={setPage} role="tablist" hasDivider>
    <Tab value="music" label={t('@yovoice.project.music')} panelId="projects-music-panel" />
    <Tab value="score" label={t('@yovoice.project.score')} panelId="projects-score-panel" />
    <Tab value="sfx" label={t('@yovoice.project.sfx')} panelId="projects-sfx-panel" />
  </TabList>;

  useEffect(() => {
    if (!ready) return;
    const items = state.history.filter(item => item.settings.id === draft.id);
    const latest = items[0];
    const key = `${draft.id}/${latest?.id ?? ''}`;
    // 切换作品或生成了新版本时跳到最新版；删除版本露出的旧版本不抢占仍然存在的当前选择。
    const surfaced = !!latest && previousHistory.current?.startsWith(`${draft.id}/`) && knownHistory.current.has(latest.id);
    const latestTrack: Track | null = latest ? { id: latest.id, name: latest.title, fileName: latest.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput') } : null;
    const changed = key !== previousHistory.current;
    // 删除了正在播放的版本时回到最新一版；试听参考音频等其他音频不受影响。
    setTrack(current => {
      const kept = current?.kind === 'outputs' && items.some(item => item.id === current.id);
      if (changed) return surfaced && kept ? current : latestTrack;
      return current?.kind === 'outputs' && !kept && !state.history.some(item => item.id === current.id) ? latestTrack : current;
    });
    previousHistory.current = key; knownHistory.current = new Set(items.map(item => item.id));
  }, [draft.id, state.history, ready, t, previousHistory, setTrack]);

  const currentVersion = track?.kind === 'outputs' ? generations.find(item => item.id === track.id) : undefined;
  // 语音生成定位为快速合成：没有作品列表，进入时直接继续当前或最近的语音作品，没有则新建一个。
  const quickOpening = useRef(false);
  useEffect(() => {
    if (!ready || page !== 'text') { quickOpening.current = false; return; }
    if (quickOpening.current) return;
    quickOpening.current = true;
    const latest = projectKind(draft) === 'text' ? draft : [...projectList].filter(d => projectKind(d) === 'text').sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
    if (latest) selectDraft(latest);
    else run(() => newDraft({ ...createDraft(false, state.preferences.uiLocale, defaultModelId), kind: 'text' }));
  });
  // 直接导出音频；新版本的文件名已带时间与内容摘要，旧的哈希文件名改用音频标题。
  const exportVersion = (item: Generation) => run(async () => {
    const stem = item.fileName.replace(/\.wav$/, '');
    await exportOutput(item.id, item.fileName, /^[0-9a-f]{32}$/.test(stem) ? item.title : stem);
  });
  const audition = (value: Track) => {
    if (page === 'create') setTrack({ ...value, playRequest: performance.now() });
    else setPreviewTrack(current => current?.id === value.id ? null : { ...value, playRequest: performance.now() });
  };
  const editorFooter = (controls?: ReactNode) => <HStack className="editor-status" hAlign="between" vAlign="center" gap={2} wrap="wrap"><HStack gap={1} vAlign="center">{projectKind(draft) === 'story' ? <SubtitleImport onError={onError} onImport={async (title, subtitles) => { await newDraft({ ...createDraft(false, state.preferences.uiLocale), ...synthesisSettings(draft), kind: 'story', title, text: subtitles.cues.map(c => c.text).join('\n'), subtitles }); }} /> : null}{controls}</HStack><HStack vAlign="center" gap={4}><small className="saved"><Check size={14} />{saveFailed ? <Button size="sm" label={t('@yovoice.app.saveFailed')} onClick={() => run(() => persistDraft(draft))} /> : saving ? t('@yovoice.app.saving') : t('@yovoice.app.saved')}</small>{projectKind(draft) === 'score' ? null : <small>{t('@yovoice.app.charCount', { count: Array.from(draft.text).length })}</small>}</HStack></HStack>;
  const defaultModelId = preferredModel(state, 'text', 'index-2.5-q8');
  // 新建作品默认用已下载的模型，并沿用上一次同类作品的选择。
  const modelFor = (kind: 'text' | 'story' | 'music' | 'score' | 'sfx') => preferredModel(state, kind, kind === 'music' ? musicModelId : kind === 'score' ? soundFontId : kind === 'sfx' ? sfxModelId : defaultModelId);
  const music = projectKind(draft) === 'music';
  const scoring = projectKind(draft) === 'score';
  const soundEffects = projectKind(draft) === 'sfx';
  // 音乐、编曲与音效作品都不使用配音时间线和“存为声音”。
  const instrumental = music || scoring || soundEffects;
  const sidebar = <SidebarNav page={page} setPage={setPage} catalog={catalog} catalogRevision={catalogRevision} openSettings={openSettings} newDraft={<NewProject hidden={state.preferences.hiddenFeatures} locale={state.preferences.uiLocale} modelId={defaultModelId} modelFor={modelFor} create={newDraft} onError={onError} button={{ 'data-testid': 'nav-new', className: 'new-project', width: '100%', size: 'md' }} />} state={state} draft={draft} selectDraft={selectDraft} removeDraft={setDeleteTarget} resizable={navigation.props} />;
  const currentCharacter = state.characters.find(c => c.id === (activeSpeaker?.characterId ?? selectedCharacter));
  const currentPerformance = activeSpeaker ? activeCue?.performance : draft.performance;
  const performances = currentCharacter?.performances ?? [];
  const inspector = scoring ? <ScoreInspector draft={draft} state={state} catalog={catalog} change={change} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => openSettings(draft.modelId)} close={() => setShowInspector(false)} /> : music || soundEffects ? <MusicInspector draft={draft} state={state} catalog={catalog} change={change} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => openSettings(draft.modelId)} upgradeEngine={() => openSettings(draft.modelId, 'engine')} close={() => setShowInspector(false)} advanced={advanced} setAdvanced={setAdvanced} soundEffects={soundEffects} /> : <Inspector libraryActions={<VStack gap={2}>
    {activeSpeaker ? <HStack gap={2} vAlign="center"><SpeakerAvatar seed={activeSpeaker.characterId ?? `${draft.id}:${activeSpeaker.id}`} /><h3>{activeSpeaker.sourceName || t('@yovoice.subtitle.speaker', { n: draft.subtitles!.speakers.indexOf(activeSpeaker) + 1 })}</h3></HStack> : null}
    <Selector label={t('@yovoice.character.choose')} isLabelHidden placeholder={t('@yovoice.character.choose')} value={activeSpeaker?.characterId ?? selectedCharacter ?? ''}
      options={[...state.characters.map(c => ({ value: c.id, label: c.name })), ...(state.characters.length ? [{ type: 'divider' as const }] : []), { value: 'new-voice', label: t('@yovoice.character.new'), icon: Plus }, { value: 'save-voice', label: t('@yovoice.character.saveAs'), icon: Save }]}
      onChange={id => { if (id === 'new-voice') { createVoice(); return; } if (id === 'save-voice') { openCharacter(); return; } const voice = state.characters.find(c => c.id === id); if (voice) applyCharacter(voice); }} />
    {performances.length || currentPerformance ? <Selector label={t('@yovoice.performance.label')} value={currentPerformance?.id ?? ''}
      options={[{ value: '', label: t('@yovoice.performance.default'), disabled: !activeSpeaker && !currentCharacter }, ...performances.map(p => ({ value: p.id, label: p.name })), ...(currentPerformance && !performances.some(p => p.id === currentPerformance.id) ? [{ value: currentPerformance.id, label: currentPerformance.name }] : [])]}
      onChange={id => {
        const performance = structuredClone(performances.find(p => p.id === id));
        if (activeSpeaker) setDraft(current => ({ ...current, subtitles: { ...current.subtitles!, cues: current.subtitles!.cues.map((cue, index) => index === selectedCue ? { ...cue, performance } : cue) } }));
        else if (currentCharacter) change({ ...performanceSettings(currentCharacter.settings, performance), performance });
      }} /> : null}
  </VStack>} catalog={catalog} close={() => setShowInspector(false)} draft={inspectorDraft} state={state} change={changeSpeaker} chooseVoice={() => setVoicePicker('voice')} chooseEmotion={() => setVoicePicker('emotion')} play={audition} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => openSettings(inspectorDraft.modelId)} advanced={advanced} setAdvanced={setAdvanced} />;
  // 播放器工具栏右侧：打开当前音频所在位置（导出在“更多”菜单里），查看历史（语音生成是“历史生成”，音乐与编曲是本作品的“版本记录”），删除在历史里处理；音乐另有播放页。
  const historyLabel = t(projectKind(draft) === 'text' ? '@yovoice.history.generations' : '@yovoice.history.versions');
  const playerActions = projectKind(draft) === 'story' ? undefined : <HStack gap={2} vAlign="center">
    {currentVersion ? <AudioCheckBadge check={currentVersion.check} /> : null}
    {currentVersion ? <Button className="player-tool" label={t('@yovoice.player.reveal')} tooltip={t('@yovoice.player.reveal')} size="sm" icon={<FolderOpen />} onClick={() => { void call('media.reveal', { kind: 'outputs', id: currentVersion.id }).catch(e => onError(noticeMessage(e))); }} /> : null}
    {currentVersion && music ? <Button className="player-tool" label={t('@yovoice.music.nowPlaying')} tooltip={t('@yovoice.music.nowPlaying')} size="sm" variant="ghost" icon={<Disc3 />} onClick={() => setNowPlaying(currentVersion)} /> : null}
    {/* 历史入口始终保留：还没生成过时也能进入历史页查看其他作品的生成记录。 */}
    <Button className="player-tool" label={historyLabel} tooltip={historyLabel} size="sm" variant="ghost" icon={<History />} onClick={() => openHistory(draft)} />
    {currentVersion ? <DropdownMenu presentation="popover" placement="above" alignment="end" hasChevron={false} menuWidth="max-content" button={{ size: 'sm', variant: 'ghost', isIconOnly: true, icon: <MoreHorizontal />, label: t('@yovoice.history.audioActions'), tooltip: t('@yovoice.history.audioActions') }} items={[
      { label: t('@yovoice.app.exportVersion'), isDisabled: busy, onClick: () => exportVersion(currentVersion) },
      ...(projectKind(draft) === 'text' ? [{ label: t('@yovoice.voice.save'), onClick: () => setVoiceEditor(currentVersion) }, { label: t('@yovoice.character.saveAs'), onClick: () => characterFromGeneration(currentVersion) }] : []),
    ]} /> : null}
  </HStack>;
  // 复用：音乐与音效版本把描述和参数填回当前作品；其余新建一个同参数的作品。
  const reuseGeneration = (item: Generation) => {
    if ((music || soundEffects) && item.settings.id === draft.id) {
      change({ text: item.settings.text, lyrics: item.settings.lyrics, abc: item.settings.abc, instrumental: item.settings.instrumental, synthesisLanguage: item.settings.synthesisLanguage, modelOptions: item.settings.modelOptions, seed: item.settings.seed, sourceGenerationId: item.settings.sourceGenerationId });
      setPreviewTrack(null); setPage('create'); return;
    }
    run(() => newDraft({ ...structuredClone(item.settings), id: newId(), title: (item.title + t('@yovoice.draft.copySuffix')).slice(0, 120), createdAt: undefined, updatedAt: undefined }));
  };
  // 检查器收起时，标题栏保留主操作：生成中显示取消，否则按作品类型显示生成或渲染。
  const generateLabel = scoring ? t('@yovoice.score.render') : soundEffects ? t('@yovoice.music.generateAudio') : music ? t(isYuE(draft.modelId) && draft.abc?.trim() ? '@yovoice.music.generateFromMelody' : '@yovoice.music.generate') : t('@yovoice.create.generate');
  const generateReady = scoring ? !!draft.score?.tracks.some(item => item.notes.length) : draft.subtitles ? draft.subtitles.cues.some(cue => cue.text.trim()) : !!draft.text.trim();
  const collapsedAction = busy ? <Button size="sm" icon={<LoaderCircle className="generation-spinner" />} label={t('@yovoice.create.cancelGenerate')} onClick={() => run(() => call('operation.cancel'))} />
    : <Button size="sm" variant="primary" label={generateLabel} aria-keyshortcuts="Control+Enter" isDisabled={!generateReady} onClick={generate} />;
  return <VStack className={`workbench ${isDesktop ? 'desktop' : 'preview'}`} style={{ '--app-nav': `${navigation.size}px` } as CSSProperties} gap={0}>
    {!isDesktop ? <HStack as="header" className="browser-titlebar" gap={2} vAlign="center"><Button label={navigation.isCollapsed ? t('@yovoice.app.expandSidebar') : t('@yovoice.app.collapseSidebar')} isIconOnly variant="ghost" size="sm" icon={<PanelLeft size={17} />} aria-expanded={!navigation.isCollapsed} onClick={toggleSidebar} /><b>yovoice</b><small>{t('@yovoice.app.browserPreview')}</small>
      {ready && !assistantHidden && launcherHidden && !assistantOpen ? <Suspense fallback={null}><AssistantTitleButton open={assistantOpen} toggle={() => setAssistantOpen(open => !open)} /></Suspense> : null}
      {page === 'create' ? <Button label={inspectorCollapsed ? t('@yovoice.app.expandInspector') : t('@yovoice.app.collapseInspector')} isIconOnly variant="ghost" size="sm" icon={<PanelRight size={17} />} aria-expanded={!inspectorCollapsed} onClick={toggleInspectorPanel} /> : null}</HStack> : null}
    <AppShell variant="elevated" sideNav={navigation.isCollapsed ? undefined : sidebar} mobileNav={{ breakpoint: 'none' }} height="fill"><VStack className="app-sheet" gap={0}>
      {characterEditor ? <VStack style={{ display: page === 'characters' ? 'flex' : 'none', height: '100%', minHeight: 0 }} gap={0}><PageBoundary name="character-editor"><CharacterEditor active={page === 'characters'} initial={characterEditor} state={state} catalog={catalog} settings={openSettings} apply={characterOrigin.current ? async saved => { const origin = characterOrigin.current!; await applyToTarget(saved, origin.draftId, origin.speakerId); setCharacterEditor(null); } : undefined} close={() => { setCharacterEditor(null); setPage(characterReturnPage.current); }} /></PageBoundary></VStack> : null}
      <VStack className="page-panel" style={{ display: characterActive ? 'none' : 'flex' }} gap={0}><Layout height="fill" footer={visited.has('create') ? <VStack gap={0} style={{ display: page === 'create' ? 'flex' : 'none' }}><PageBoundary name="timeline" resetKey={draft.id}>{scoring ? <ScoreDock key={draft.id} draft={draft} change={change} playhead={track ? playback : undefined} seek={time => setSeekRequest({ time, nonce: performance.now() })} /> : null}{draft.timeline || projectKind(draft) === 'story' ? <TimelineEditor exportProject={async () => { await persistDraft(draft); await call('project.export', { id: draft.id, name: draft.title }); }} key={draft.id} selectedCue={selectedCue} cueSelectionRevision={cueSelection?.revision ?? 0} playbackCue={setPlayingCue} selectCue={selectCue} draft={draft} busy={busy} regenerate={async (cueId, clipId) => { await persistDraft(draft); await call('generation.cue', { draft, cueId, clipId }); }} value={draft.timeline ?? { tracks: [] }} history={state.history} drafts={projectList} change={timeline => change({ timeline })} suspended={page !== 'create' || voicePicker !== null || characterActive || !!voiceEditor || !!voiceTarget} onError={onError} /> : <Player onProgress={(time, playing) => { reportPlayhead(time); if (scoring) setPlayback({ time, playing }); }} seekRequest={scoring ? seekRequest : undefined} actions={playerActions} reveal={false} suspended={page !== 'create' || voicePicker !== null || characterActive || !!voiceEditor || !!voiceTarget || !!nowPlaying} track={track} onError={onError} />}</PageBoundary></VStack> : null} content={<VStack className="content-frame" gap={0}>
        {!ready ? <p className="loading" role="status">{t('@yovoice.app.loading')}</p> : <>

          {visited.has('create') ? <VStack className="page-panel" gap={0} style={{ display: page === 'create' ? 'flex' : 'none' }}><PageBoundary name="create" resetKey={draft.id}>
            <Studio showInspector={showInspector} inspector={inspector} inspectorCollapsed={inspectorCollapsed} collapsedAction={collapsedAction}
          title={<input className="document-title" aria-label={t('@yovoice.app.titleLabel')} maxLength={120} value={draft.title} onChange={e => change({ title: e.target.value })} />}
          writingClassName={`${draft.subtitles ? 'writing-subtitles' : ''} ${draft.timeline ? 'writing-timeline' : ''} ${scoring ? 'writing-score' : ''}`.trim()}>
          {scoring ? <><ScoreEditor key={draft.id} draft={draft} change={change} locale={state.preferences.uiLocale} onError={onError} />{editorFooter()}</> : soundEffects ? <><SfxEditor key={draft.id} draft={draft} change={change} />{editorFooter()}</> : music ? <><MusicEditor key={draft.id} draft={draft} state={state} change={change} locale={state.preferences.uiLocale} onError={onError} />{editorFooter()}</> : draft.subtitles ? <SubtitleEditor key={draft.id} history={state.history} playingCue={playingCue} failedCue={activity?.projectId === draft.id && activity.status === 'failed' ? activity.cueId : undefined} draft={draft} characters={state.characters ?? []} change={change} selectedCue={selectedCue} selectCue={selectCue} renderFooter={editorFooter} /> : <><textarea ref={editor} className="script-editor" aria-label={t('@yovoice.app.scriptLabel')} placeholder={t('@yovoice.app.scriptPlaceholder')} maxLength={12000} value={draft.text} spellCheck={false} dir={draft.language === 'ar' ? 'rtl' : 'auto'} onChange={e => change({ text: e.target.value })} />{editorFooter()}</>}
        </Studio>
          </PageBoundary></VStack> : null}
          {(['story', 'music', 'score', 'sfx'] as const).filter(kind => visited.has(kind)).map(kind => <VStack key={kind} id={`projects-${kind}-panel`} className="page-panel" gap={0} style={{ display: page === kind ? 'flex' : 'none' }}><PageBoundary name={`projects-${kind}`}>
            <Projects onError={onError} kind={kind} title={kind === 'story' ? undefined : t('@yovoice.project.music')} controls={kind === 'story' ? undefined : musicTabs} drafts={projectList} open={selectDraft} history={openHistory} create={kind === 'story' ? <HStack gap={2} vAlign="center"><BookImport state={state} modelId={defaultModelId} configureAI={() => openSettings(defaultModelId, 'ai')} create={importBook} onError={onError} /><NewProject kind={kind} locale={state.preferences.uiLocale} modelId={defaultModelId} modelFor={modelFor} create={newDraft} onError={onError} /></HStack> : <NewProject kind={kind} locale={state.preferences.uiLocale} modelId={defaultModelId} modelFor={modelFor} create={newDraft} onError={onError} />} copy={item => run(() => newDraft({ ...structuredClone(item), id: newId(), title: (item.title + t('@yovoice.draft.copySuffix')).slice(0, 120), createdAt: undefined, updatedAt: undefined }))} remove={setDeleteTarget} save={async next => { await persistDraft(draft); await persistDraft(next); if (next.id === draft.id) setDraft(next); }} />
          </PageBoundary></VStack>)}
          {visited.has('characters') ? <VStack id="voice-library-panel" className="page-panel" gap={0} style={{ display: page === 'characters' ? 'flex' : 'none' }}><PageBoundary name="characters">
            <CharacterLibrary controls={libraryTabs} active={page === 'characters' && !voiceTarget && !characterActive} create={createVoice} state={state} catalog={catalog} edit={editCharacter} apply={setVoiceTarget} onError={onError} />
          </PageBoundary></VStack> : null}
          {visited.has('settings') ? <VStack className="page-panel" gap={0} style={{ display: page === 'settings' ? 'flex' : 'none' }}>
            <PageBoundary name="settings"><Suspense fallback={<p role="status">{t('@yovoice.app.loadingSettings')}</p>}><Settings focus={settingsFocus} state={state} catalog={catalog} engine={engine} draft={draft} run={run} active={page === 'settings'} onError={onError}
              openProject={id => { const item = state.drafts.find(d => d.id === id); if (item) selectDraft(item); }} /></Suspense></PageBoundary>
          </VStack> : null}
          {(['voices', 'history'] as const).filter(destination => visited.has(destination)).map(destination => <VStack key={destination} id={destination === 'voices' ? 'reference-library-panel' : undefined} className="page-panel" gap={0} style={{ display: page === destination ? 'flex' : 'none' }}><PageBoundary name={destination}>
            <MediaLibrary page={destination} project={draft} controls={destination === 'voices' ? libraryTabs : <HStack gap={2} vAlign="center">
              <Button size="sm" label={t('@yovoice.history.backProject')} onClick={() => { setPreviewTrack(null); setPage('create'); }} />
            </HStack>} state={state}
              query={destination === 'voices' ? voiceQuery : historyQuery} onQueryChange={destination === 'voices' ? setVoiceQuery : setHistoryQuery}
              track={page === destination ? previewTrack : null} audition={audition} stop={() => setPreviewTrack(null)} suspended={page !== destination || voicePicker !== null || !!voiceEditor || !!nowPlaying}
              addVoice={() => setVoicePicker('add')} editVoice={setVoiceEditor} saveCharacter={characterFromGeneration} onError={onError}
              reuse={reuseGeneration} exportItem={exportVersion} play={setNowPlaying} />
          </PageBoundary></VStack>)}
        </>}

      </VStack>} /></VStack>
    </VStack></AppShell>
    {ready && !assistantHidden ? <Suspense fallback={null}><AssistantDock state={state} open={assistantOpen} setOpen={setAssistantOpen} context={{ ...assistantContext, page: assistantContext.page === 'create' ? 'text' : assistantContext.page }} expanded={assistantExpanded} quickActions={quickActions(t, assistantPage === 'create' ? 'text' : assistantPage)} onToggleExpand={() => setAssistantExpanded(expanded => !expanded)} actions={askAssistantPanel} launcherHidden={launcherHidden} showLauncher={showLauncher} nudge={nudge} onNudge={actOnNudge} dismissNudge={dismissNudge} /></Suspense> : null}
    <Notifications error={error} clearError={() => setError('')} activity={activity} modelActivity={state.modelActivity} draftId={draft.id} page={page} cancel={() => run(() => call('operation.cancel'))} cancelModel={() => run(() => call('model.cancel'))}
      aiTask={state.aiTask} aiTitle={state.drafts.find(item => item.id === state.aiTask?.projectId)?.title} openAITask={() => { const target = state.drafts.find(item => item.id === state.aiTask?.projectId); if (target) selectDraft(target); }}><UpdateNotice /></Notifications>
    <UpdateDialogHost />
    {ready && !draft.subtitles && !instrumental && isIndexModel(draft.modelId) && page === 'create' && !voicePicker && !pronunciation && !deleteTarget ? <SelectionAction key={draft.id} editor={editor} onEdit={annotate} /> : null}

    {voiceTarget ? <VoiceTarget voice={voiceTarget} drafts={projectList} apply={applyToTarget} close={() => setVoiceTarget(null)} /> : null}
    {deleteTarget ? <ConfirmDelete title={t('@yovoice.app.deleteProjectTitle')} description={t('@yovoice.app.deleteProjectBody', { title: deleteTarget.title })}
      confirmLabel={t('@yovoice.app.deleteProjectConfirm')} busy={deleting} error={formatNotice(t, deleteError)} onClose={() => setDeleteTarget(null)} onConfirm={() => void deleteDraft()} /> : null}
    {nowPlaying ? <NowPlaying item={nowPlaying} title={nowPlaying.title} versions={state.history.filter(item => item.settings.id === nowPlaying.settings.id && !item.segment)}
      aligner={state.models.some(model => isAligner(model.id))} activity={activity} getAligner={() => { setNowPlaying(null); openSettings(catalog.find(model => model.family === 'lyric_align')?.id, 'models'); }} close={() => setNowPlaying(null)} onError={onError} /> : null}
    {voiceEditor ? <VoiceEditor item={voiceEditor} close={() => setVoiceEditor(null)} /> : null}
    {voicePicker ? <Suspense fallback={<p role="status">{t('@yovoice.app.loadingVoicePicker')}</p>}><VoicePicker adding={voicePicker === 'add'} voices={state.voices} onClose={() => setVoicePicker(null)} onSelect={voice => { if ((activeSpeaker || draft.performance) && voicePicker !== 'add') { changeSpeaker(voicePicker === 'emotion' ? { emotionVoiceId: voice.id } : { voiceId: voice.id, referenceText: voice.referenceText ?? '' }); setVoicePicker(null); } else selectVoice(voice); }} /></Suspense> : null}
    {pronunciation ? <PronunciationDialog pronunciation={pronunciation} setPronunciation={setPronunciation} draft={draft} change={change} editor={editor} /> : null}
    {showIntro ? <IntroScreen onStart={finishIntro} /> : null}
    {showTour ? <GuideTour hidden={state.preferences.hiddenFeatures} onClose={finishTour} /> : null}
  </VStack>;
}
