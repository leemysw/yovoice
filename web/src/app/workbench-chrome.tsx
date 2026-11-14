import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack, Layout } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { PanelLeft, PanelRight, Check, Disc3, FolderOpen, History, LoaderCircle, MoreHorizontal, Share2 } from 'lucide-react';
import { NewProject, Projects, useNewProject } from '../features/library/projects';
import { MediaLibrary } from '../features/library/media-library';
import { CharacterEditor, CharacterLibrary } from '../features/library/characters';
import { Studio } from '../features/create/studio';
import { SubtitleImport, SubtitleEditor } from '../features/create/subtitles';
import { musicModelId } from '../features/music/music-draft';
import { soundFontId } from '../features/score/score-draft';
import { SfxEditor } from '../features/sfx/sfx-editor';
import { sfxModelId } from '../features/sfx/sfx-draft';
import { Timeline } from '../features/media/timeline';
import { Player } from '../features/media/player';
import { call, exportOutput, isDesktop } from '../shared/lib/client';
import { noticeMessage } from '../shared/lib/call-error';
import { isYuE, projectKind, createDraft, requiresVoice, synthesisSettings, type Draft, type EngineInfo, type State, type ModelPackage, type Voice, type Generation, type Track, preferredModel, newId } from '../shared/workbench';
// 助手（含形象与点阵动画）首屏后再加载，不占主包。
const AssistantDock = lazy(() => import('../features/assistant/assistant-dock').then(module => ({ default: module.AssistantDock })));
const AssistantTitleButton = lazy(() => import('../features/assistant/assistant-dock').then(module => ({ default: module.AssistantTitleButton })));
import { quickActions } from '../features/assistant/assistant-launch';
import { reportPlayhead } from '../features/assistant/assistant-focus';
import { SidebarNav } from './sidebar-nav';
import { PageBoundary } from '../shared/ui/page-boundary';
import type { Pronunciation } from './pronunciation-dialog';
import type { DraftSession } from './use-draft-session';
import { AudioCheckBadge } from '../features/media/audio-check';
import { kindHidden, useWorkbenchNavigation } from './use-workbench-navigation';
import { useStoryCueEditing } from './use-story-cue-editing';
import { useAssistantBridge } from './use-assistant-bridge';
import { useOnboarding } from './use-onboarding';
import { generateCommand, useGenerate } from './use-generate';
import { useCharacterFlow } from './use-character-flow';
import { InspectorSlot } from './inspector-slot';
import { WorkbenchOverlays, type VoicePickerMode } from './workbench-overlays';
import { CaptionDialog } from '../features/media/caption-dialog';
import { VersionExportDialog } from '../features/media/version-export-dialog';
import { ShareDialog } from '../features/community/share-dialog';
import { coverJpeg } from '../features/music/song-cover';
import type { StudioTarget } from '../features/music/stem-studio';
import { useHotkey, useHotkeyAria, useHotkeyDispatcher, useHotkeyText, withHotkey } from '../shared/hotkeys/hotkeys';
import { useGlobalHotkeys } from './use-global-hotkeys';
import { HotkeyCheatsheet } from './hotkey-cheatsheet';
const Settings = lazy(() => import('../features/settings/settings').then(module => ({ default: module.Settings })));
// 页面级组件按需加载：音乐、编曲、时间线与导入书稿只在用到时取回，首屏主包只含外壳与语音编辑。
const MusicEditor = lazy(() => import('../features/music/music-editor').then(module => ({ default: module.MusicEditor })));
const ScoreEditor = lazy(() => import('../features/score/score-editor').then(module => ({ default: module.ScoreEditor })));
const ScoreDock = lazy(() => import('../features/score/score-arrangement').then(module => ({ default: module.ScoreDock })));
const TimelineEditor = lazy(() => import('../features/media/timeline-editor').then(module => ({ default: module.TimelineEditor })));
// 语音转写页带字幕编辑，打开时再加载。
const TranscribePage = lazy(() => import('../features/transcribe/transcribe-page').then(module => ({ default: module.TranscribePage })));
// 分轨工作台（分轨与转 MIDI 的结果）按需加载。
const StemStudio = lazy(() => import('../features/music/stem-studio').then(module => ({ default: module.StemStudio })));
const BookImport = lazy(() => import('../features/library/book-import').then(module => ({ default: module.BookImport })));

// 工作台界面：导航、页面切换与各页面之间的协作；作品保存由 useDraftSession 负责。
// 导航与面板、助手衔接、开场引导、生成校验、台词编辑与角色流程各在自己的 hook 里，这里只做拼装；hook 的调用顺序即 effect 的执行顺序。
export function WorkbenchChrome({ state, catalog, catalogRevision, engine, ready, session, error, setError }: { state: State; catalog: ModelPackage[]; catalogRevision: string; engine: EngineInfo; ready: boolean; session: DraftSession; error: string; setError: (message: string) => void }) {
  const t = useTranslator();
  const { draft, setDraft, draftPersisted, setDraftPersisted, saving, saveFailed, change, persistDraft, setActive, setDeleteTarget } = session;
  // 分轨工作台：分离完成或转 MIDI 完成后自动打开，版本菜单的“打开分轨”与编曲页的“分轨试听”也进入这里。
  const [studio, setStudio] = useState<StudioTarget | null>(null);
  const { navigation, inspectorPanel, isCollapsed, expand, toggleSidebar, page, setPage, visited, settingsFocus, openSettings, showInspector, setShowInspector, inspectorCollapsed, inspectorAvailable, toggleInspectorPanel } = useWorkbenchNavigation({ draft, catalog, preferences: state.preferences, overlay: !!studio, setActive, setError });
  const previousVoices = useRef<Voice[]>([]);
  const [voicePicker, setVoicePicker] = useState<VoicePickerMode>(null);
  const [previewTrack, setPreviewTrack] = useState<Track | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  // 编曲视图与底部播放器共用播放位置：播放器上报进度，点标尺发出跳转请求。
  const [playback, setPlayback] = useState({ time: 0, playing: false }); const [seekRequest, setSeekRequest] = useState<{ time: number; nonce: number }>(); const [advanced, setAdvanced] = useState(false);
  const [pronunciation, setPronunciation] = useState<Pronunciation | null>(null);
  // 检查器顶部的角色选择框，选择角色快捷键据此找到它。
  const characterSelectorId = 'inspector-character';
  const editor = useRef<HTMLTextAreaElement>(null); const previousHistory = useRef<string | undefined>(undefined); const knownHistory = useRef(new Set<string>());
  const onError = useCallback((message: string) => setError(message), [setError]);
  const run = useCallback((action: () => Promise<unknown>) => { void action().catch(e => setError(noticeMessage(e))); }, [setError]);
  async function newDraft(next: Draft) {
    if (draftPersisted) await persistDraft(draft); await persistDraft(next);
    setDraft(next); setPage('create');
  }
  // 整本书导入的多个章节作品：倒序保存让第一章排在最前，最后打开第一章。
  // saved 记下已入库的章节：中途失败后重试时跳过它们，不重复创建。
  async function importBook(drafts: Draft[], saved: Set<string>) {
    for (const item of drafts.slice(1).reverse()) {
      if (saved.has(item.id)) continue;
      await call('draft.save', item);
      saved.add(item.id);
    }
    await newDraft(drafts[0]);
  }
  function selectDraft(item: Draft) { run(async () => { if (draftPersisted) await persistDraft(draft); setDraft(item.id === draft.id ? draft : item); setDraftPersisted(true); setPage('create'); }); }
  const cues = useStoryCueEditing({ draft, setDraft, setDraftPersisted, page });
  const { playingCue, setPlayingCue, cueSelection, selectedCue, selectCue } = cues;
  // 正在分享到社区的版本；播放栏按钮和 Ocho 的分享提示都会打开它。
  const [shareTarget, setShareTarget] = useState<Generation | null>(null);
  const { assistantOpen, setAssistantOpen, assistantExpanded, setAssistantExpanded, launcherHidden, showLauncher, assistantHidden, assistantPage, askAssistantPanel, assistantContext, nudge, dismissNudge, actOnNudge } = useAssistantBridge({ state, page, setPage, draft, setDraft, setDraftPersisted, saving, openSettings, selectDraft, cue: cues.focusCue, setError, share: projectId => setShareTarget(state.history.find(item => item.settings.id === projectId && !item.stemOf) ?? null) });
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
  const { showIntro, finishIntro, showTour, finishTour } = useOnboarding({ state, ready, error, isCollapsed, expand, setError });
  useEffect(() => { if (ready) setDraft(current => Timeline.accept(current, state.history)); }, [state.history, draft.id, ready, setDraft]);
  const generate = useGenerate({ state, engine, catalog, draft, page, openSettings, run, persistDraft, setVoicePicker });
  const generations = state.history.filter(item => item.settings.id === draft.id);
  const activity = state.activity; const busy = activity?.status === 'running';
  useHotkeyDispatcher(state.preferences.hotkeys);
  useGlobalHotkeys({ page, setPage, openSettings, toggleSidebar, toggleInspector: toggleInspectorPanel, inspectorAvailable, toggleAssistant: () => setAssistantOpen(open => !open), assistantHidden, busy, preferences: state.preferences });
  const projectList = state.drafts.map(d => d.id === draft.id ? { ...draft, createdAt: d.createdAt, updatedAt: d.updatedAt } : d);
  const [voiceQuery, setVoiceQuery] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const openHistory = (item: Draft) => run(async () => { if (draftPersisted) await persistDraft(draft); setDraft(item); setDraftPersisted(true); setHistoryQuery(''); setPreviewTrack(null); setPage('history'); });
  const { characterEditor, setCharacterEditor, characterActive, characterReturnPage, characterOrigin, selectedCharacter, applyCharacter, editCharacter, openCharacter, characterFromGeneration, createVoice, voiceTarget, setVoiceTarget, applyToTarget } = useCharacterFlow({ t, state, page, setPage, session, newDraft, projectList, cues });
  const [voiceEditor, setVoiceEditor] = useState<Voice | Generation | null>(null);
  // 正在导出字幕的语音版本。
  const [captionTarget, setCaptionTarget] = useState<Generation | null>(null);
  const [exportTarget, setExportTarget] = useState<Generation | null>(null);
  const pendingStems = useRef<{ sourceId: string; old: Set<string> } | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Generation | null>(null);
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
  // 播放键两侧切换版本：只在成品版本之间切（分轨不算），列表新的在前，所以上一版是更早的那一项。
  const playableVersions = generations.filter(item => !item.stemOf);
  const versionIndex = currentVersion ? playableVersions.findIndex(item => item.id === currentVersion.id) : -1;
  const switchTo = (item: Generation | undefined) => item ? (play: boolean) => setTrack({ id: item.id, name: item.title, fileName: item.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput'), playRequest: play ? performance.now() : undefined }) : null;
  const versionSwitch = playableVersions.length > 1 ? { previous: versionIndex < 0 ? null : switchTo(playableVersions[versionIndex + 1]), next: versionIndex < 0 ? null : switchTo(playableVersions[versionIndex - 1]) } : undefined;
  // 快捷键要用检查器里的控件时：检查器收起或窄屏隐藏就先展开，等控件显示出来（展开带视图过渡，晚几帧）再聚焦并打开它。
  const openInspectorControl = (id: string) => {
    const visible = () => { const element = document.getElementById(id); return element && element.getClientRects().length > 0 ? element : null; };
    if (!visible()) toggleInspectorPanel();
    let frames = 0;
    const open = () => {
      const element = visible();
      if (!element) { if (++frames < 30) requestAnimationFrame(open); return; }
      element.focus();
      if (element instanceof HTMLSelectElement) element.showPicker?.(); else element.click();
    };
    requestAnimationFrame(open);
  };
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
  // 导出名称：新版本的文件名已带时间与内容摘要，旧的哈希文件名改用音频标题。
  const versionName = (item: Generation) => { const stem = item.fileName.replace(/\.wav$/, ''); return /^[0-9a-f]{32}$/.test(stem) ? item.title : stem; };
  // 导出音频：桌面端先选格式与响度，浏览器预览直接下载 WAV。
  const exportVersion = (item: Generation) => { if (isDesktop) setExportTarget(item); else run(() => exportOutput(item.id, item.fileName, versionName(item))); };
  // 分轨与转为 MIDI 在后台运行，进度在活动栏；分轨结果作为版本出现在版本记录里，扒出的 MIDI 新建编曲作品后自动打开。
  // 重新分离时记下旧分轨，等新分轨换上来再打开工作台。
  const separateStems = (item: Generation, replace = false) => run(async () => {
    const old = new Set(state.history.filter(stem => stem.stemOf === item.id).map(stem => stem.id));
    if (replace) setStudio(null);
    await call('generation.separateStems', { id: item.id, replace });
    pendingStems.current = { sourceId: item.id, old };
  });
  const deleteStems = async (item: Generation) => { await call('generation.deleteStems', { id: item.id }); setStudio(null); };
  const openStems = (item: Generation) => setStudio({ kind: 'stems', sourceId: item.stemOf ?? item.id });
  // 分离结束、分轨出现在版本里时打开工作台，让人马上听到效果。
  useEffect(() => {
    const pending = pendingStems.current;
    if (!pending || state.activity?.status === 'running' || !state.history.some(item => item.stemOf === pending.sourceId && !pending.old.has(item.id))) return;
    const { sourceId } = pending;
    pendingStems.current = null;
    setStudio({ kind: 'stems', sourceId });
  }, [state.history, state.activity?.status]);
  const transcribeMidi = (item: Generation) => run(() => call('generation.transcribeMidi', { id: item.id }));
  // 原混音和全部分轨按 DAW 习惯命名后导出到所选文件夹，由宿主弹出文件夹选择框。
  const exportStems = (item: Generation) => run(() => call('stems.export', { id: item.id }));
  // 局部重唱：按当前作品的谱和歌词，只重唱这一版里改动的小节，其余部分保持原样。
  const canResing = (item: Generation) => music && isYuE(draft.modelId) && isYuE(item.settings.modelId) && item.settings.id === draft.id && !item.stemOf && !item.segment && !!item.settings.abc?.trim() && !!draft.abc?.trim();
  const resing = (item: Generation) => run(async () => { await persistDraft(draft); await call('generation.resing', { id: item.id, draft }); });
  const midiImport = state.midiImport;
  useEffect(() => {
    if (!midiImport) return;
    const target = state.drafts.find(item => item.id === midiImport.projectId);
    if (target) { selectDraft(target); setStudio({ kind: 'midi', projectId: target.id, sourceId: midiImport.sourceId }); }
    void call('midi.dismiss', { id: midiImport.id }).catch(() => undefined);
    // 只在出现新结果时打开一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midiImport?.id]);
  // FLAC / M4A 的标签：标题取版本标题、专辑取作品名；音乐另写歌词和与播放页相同的封面。
  const exportTags = (item: Generation) => async () => projectKind(item.settings) === 'music'
    ? { title: item.title, album: draft.title, lyrics: item.settings.lyrics, cover: await coverJpeg(state.history.find(entry => entry.id === item.id) ?? item) }
    : { title: item.title, album: draft.title };
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
  // 新建快捷键随当前页面新建：列表页新建该类作品，编辑页与版本记录新建同类作品；其他页面（我的声音等）由各自页面注册。
  // 注册在这里而不是侧栏按钮上，侧栏收起时也能用。
  const creator = useNewProject({ locale: state.preferences.uiLocale, modelId: defaultModelId, modelFor, create: newDraft, onError });
  // 当前作品所属的功能在设置里被隐藏时（仍停留在它的编辑页），不再新建这类作品。
  const pageKind = page === 'story' || page === 'music' || page === 'score' || page === 'sfx' ? page : page === 'create' || page === 'history' ? projectKind(draft) : page === 'text' ? 'text' : undefined;
  const newKind = pageKind && !kindHidden(state.preferences, pageKind) ? pageKind : undefined;
  useHotkey('global.new', () => { if (newKind) void creator.start(newKind); }, { enabled: !!newKind && !creator.busy });
  // 语音生成作品的编辑页快捷键：导入文件、选择角色、参考音频、版本记录与导出此版本。
  const voiceEditing = page === 'create' && projectKind(draft) === 'text';
  useHotkey('create.import', creator.chooseFile, { enabled: voiceEditing && !creator.busy });
  useHotkey('create.character', () => openInspectorControl(characterSelectorId), { enabled: voiceEditing });
  useHotkey('create.reference', () => setVoicePicker('voice'), { enabled: voiceEditing && requiresVoice(cues.inspectorDraft) });
  useHotkey('create.history', () => openHistory(draft), { enabled: voiceEditing });
  // 有配音时间线时底部是时间线（导出整条时间线），没有“导出此版本”。
  useHotkey('create.export', () => { if (currentVersion) exportVersion(currentVersion); }, { enabled: voiceEditing && !draft.timeline && !!currentVersion && !busy });
  // 音乐与音效作品的编辑页快捷键：播放页、分轨、版本记录与导出此版本；生成在 useGenerate 里。
  // 作品所属的功能（故事配音、音乐生成）在设置里隐藏后，仍停留在它的编辑页也不响应它的快捷键。
  const draftHidden = kindHidden(state.preferences, projectKind(draft));
  const createVisible = page === 'create' && !characterActive && !draftHidden;
  const songEditing = createVisible && music, sfxEditing = createVisible && soundEffects;
  const hasStems = !!currentVersion && (!!currentVersion.stemOf || state.history.some(item => item.stemOf === currentVersion.id));
  useHotkey('music.nowPlaying', () => { if (currentVersion) setNowPlaying(currentVersion); }, { enabled: songEditing && !!currentVersion && !nowPlaying });
  useHotkey('music.stems', () => { if (!currentVersion) return; if (hasStems) openStems(currentVersion); else separateStems(currentVersion); }, { enabled: songEditing && !!currentVersion && (hasStems || !busy) && !studio });
  useHotkey('music.history', () => openHistory(draft), { enabled: songEditing });
  useHotkey('music.export', () => { if (currentVersion) exportVersion(currentVersion); }, { enabled: songEditing && !!currentVersion && !busy });
  useHotkey('sfx.history', () => openHistory(draft), { enabled: sfxEditing });
  useHotkey('sfx.export', () => { if (currentVersion) exportVersion(currentVersion); }, { enabled: sfxEditing && !!currentVersion && !busy });
  // 播放器工具栏上“版本记录”“导出此版本”的按键提示按作品类型取对应的命令；编曲没有这两条快捷键，不显示。
  const versionHotkeys = music ? { history: 'music.history', export: 'music.export', on: songEditing } : soundEffects ? { history: 'sfx.history', export: 'sfx.export', on: sfxEditing } : { history: 'create.history', export: 'create.export', on: voiceEditing };
  const historyKeys = useHotkeyText(versionHotkeys.history), historyAria = useHotkeyAria(versionHotkeys.history), exportKeys = useHotkeyText(versionHotkeys.export);
  const nowPlayingKeys = useHotkeyText('music.nowPlaying'), nowPlayingAria = useHotkeyAria('music.nowPlaying'), stemsKeys = useHotkeyText('music.stems');
  const backKeys = useHotkeyText('global.back'), backAria = useHotkeyAria('global.back');
  // 侧栏与下方各个浮层各自包一层边界：任一处渲染出错只影响它自己，工作区照常可用。
  const sidebar = <PageBoundary name="sidebar" resetKey={draft.id}><SidebarNav page={page} setPage={setPage} catalog={catalog} catalogRevision={catalogRevision} openSettings={openSettings} newDraft={<NewProject creator={creator} hotkey={!!newKind} hidden={state.preferences.hiddenFeatures} locale={state.preferences.uiLocale} modelId={defaultModelId} modelFor={modelFor} create={newDraft} onError={onError} button={{ 'data-testid': 'nav-new', className: 'new-project', width: '100%', size: 'md' }} />} state={state} draft={draft} selectDraft={selectDraft} removeDraft={setDeleteTarget} resizable={navigation.props} /></PageBoundary>;
  const inspector = <InspectorSlot draft={draft} setDraft={setDraft} change={change} state={state} catalog={catalog} generate={generate} run={run} openSettings={openSettings} setShowInspector={setShowInspector} advanced={advanced} setAdvanced={setAdvanced} cues={cues} selectedCharacter={selectedCharacter} setVoicePicker={setVoicePicker} audition={audition} createVoice={createVoice} openCharacter={openCharacter} applyCharacter={applyCharacter} characterSelectorId={characterSelectorId} />;
  // 播放器工具栏右侧：打开当前音频所在位置（导出在“更多”菜单里），查看历史（语音生成是“历史生成”，音乐与编曲是本作品的“版本记录”），删除在历史里处理；音乐另有播放页。
  const historyLabel = t(projectKind(draft) === 'text' ? '@yovoice.history.generations' : '@yovoice.history.versions');
  const playerActions = projectKind(draft) === 'story' ? undefined : <HStack gap={2} vAlign="center">
    {currentVersion ? <AudioCheckBadge check={currentVersion.check} /> : null}
    {/* 歌曲版本的主操作：分享到社区放在播放栏最前面，用主色按钮。 */}
    {currentVersion && music && !currentVersion.stemOf ? <Button className="player-share" label={t('@yovoice.community.share')} size="sm" variant="primary" icon={<Share2 />} onClick={() => setShareTarget(currentVersion)} /> : null}
    {currentVersion ? <Button className="player-tool" label={t('@yovoice.player.reveal')} tooltip={t('@yovoice.player.reveal')} size="sm" icon={<FolderOpen />} onClick={() => { void call('media.reveal', { kind: 'outputs', id: currentVersion.id }).catch(e => onError(noticeMessage(e))); }} /> : null}
    {currentVersion && music ? <Button className="player-tool" label={t('@yovoice.music.nowPlaying')} tooltip={withHotkey(t('@yovoice.music.nowPlaying'), songEditing ? nowPlayingKeys : '')} aria-keyshortcuts={songEditing ? nowPlayingAria : undefined} size="sm" variant="ghost" icon={<Disc3 />} onClick={() => setNowPlaying(currentVersion)} /> : null}
    {/* 历史入口始终保留：还没生成过时也能进入历史页查看其他作品的生成记录。 */}
    <Button className="player-tool" label={historyLabel} tooltip={withHotkey(historyLabel, versionHotkeys.on ? historyKeys : '')} aria-keyshortcuts={versionHotkeys.on ? historyAria : undefined} size="sm" variant="ghost" icon={<History />} onClick={() => openHistory(draft)} />
    {currentVersion ? <DropdownMenu presentation="popover" placement="above" alignment="end" hasChevron={false} menuWidth="max-content" button={{ size: 'sm', variant: 'ghost', isIconOnly: true, icon: <MoreHorizontal />, label: t('@yovoice.history.audioActions'), tooltip: t('@yovoice.history.audioActions') }} items={[
      { label: t('@yovoice.app.exportVersion'), endContent: versionHotkeys.on && exportKeys ? exportKeys : undefined, isDisabled: busy, onClick: () => exportVersion(currentVersion) },
      ...(music && !currentVersion.stemOf && !state.history.some(item => item.stemOf === currentVersion.id) ? [{ label: t('@yovoice.stems.separate'), endContent: songEditing && stemsKeys ? stemsKeys : undefined, isDisabled: busy, onClick: () => separateStems(currentVersion) }] : []),
      ...(canResing(currentVersion) ? [{ label: t('@yovoice.resing.action'), isDisabled: busy, onClick: () => resing(currentVersion) }] : []),
      ...(music && (currentVersion.stemOf || state.history.some(item => item.stemOf === currentVersion.id)) ? [{ label: t('@yovoice.stems.open'), endContent: songEditing && stemsKeys ? stemsKeys : undefined, onClick: () => openStems(currentVersion) }] : []),
      ...(music && !currentVersion.stemOf && state.history.some(item => item.stemOf === currentVersion.id) ? [{ label: t('@yovoice.stems.resplit'), isDisabled: busy, onClick: () => separateStems(currentVersion, true) }] : []),
      ...(music ? [{ label: t('@yovoice.stems.toMidi'), isDisabled: busy, onClick: () => transcribeMidi(currentVersion) }] : []),
      ...(projectKind(draft) === 'text' ? [{ label: t('@yovoice.caption.menu'), onClick: () => setCaptionTarget(currentVersion) }, { label: t('@yovoice.voice.save'), onClick: () => setVoiceEditor(currentVersion) }, { label: t('@yovoice.character.saveAs'), onClick: () => characterFromGeneration(currentVersion) }] : []),
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
  // 检查器收起时，标题栏保留主操作：生成中显示取消，否则按作品类型显示生成或渲染；按键提示与 useGenerate 注册的命令一致。
  const generateKeys = useHotkeyText(generateCommand(draft)), generateAria = useHotkeyAria(generateCommand(draft));
  const generateHint = draftHidden ? '' : generateKeys;
  const cancelKeys = useHotkeyText('global.cancel'), cancelAria = useHotkeyAria('global.cancel');
  const generateLabel = scoring ? t('@yovoice.score.render') : soundEffects ? t('@yovoice.music.generateAudio') : music ? t(isYuE(draft.modelId) && draft.abc?.trim() ? '@yovoice.music.generateFromMelody' : '@yovoice.music.generate') : t('@yovoice.create.generate');
  const generateReady = scoring ? !!draft.score?.tracks.some(item => item.notes.length) : draft.subtitles ? draft.subtitles.cues.some(cue => cue.text.trim()) : !!draft.text.trim();
  // 生成与取消是两个不同的按钮（key 不同）：鼠标点了“生成”后焦点不会留在原地变成“取消生成”，再按空格不会误取消。
  const collapsedAction = busy ? <Button key="cancel" size="sm" icon={<LoaderCircle className="generation-spinner" />} label={t('@yovoice.create.cancelGenerate')} tooltip={withHotkey(t('@yovoice.create.cancelGenerate'), cancelKeys, undefined)} aria-keyshortcuts={cancelAria} onClick={() => run(() => call('operation.cancel'))} />
    : <Button key="generate" size="sm" variant="primary" label={generateLabel} tooltip={withHotkey(generateLabel, generateHint, undefined)} aria-keyshortcuts={draftHidden ? undefined : generateAria} isDisabled={!generateReady} onClick={generate} />;
  return <VStack className={`workbench ${isDesktop ? 'desktop' : 'preview'}`} style={{ '--app-nav': `${navigation.size}px`, '--app-inspector': `${inspectorPanel.size}px` } as CSSProperties} gap={0}>
    {!isDesktop ? <HStack as="header" className="browser-titlebar" gap={2} vAlign="center"><Button label={navigation.isCollapsed ? t('@yovoice.app.expandSidebar') : t('@yovoice.app.collapseSidebar')} isIconOnly variant="ghost" size="sm" icon={<PanelLeft size={17} />} aria-expanded={!navigation.isCollapsed} onClick={toggleSidebar} /><b>yovoice</b><small>{t('@yovoice.app.browserPreview')}</small>
      {ready && !assistantHidden && launcherHidden && !assistantOpen ? <PageBoundary name="assistant-title"><Suspense fallback={null}><AssistantTitleButton open={assistantOpen} toggle={() => setAssistantOpen(open => !open)} /></Suspense></PageBoundary> : null}
      {inspectorAvailable ? <Button label={inspectorCollapsed ? t('@yovoice.app.expandInspector') : t('@yovoice.app.collapseInspector')} isIconOnly variant="ghost" size="sm" icon={<PanelRight size={17} />} aria-expanded={!inspectorCollapsed} onClick={toggleInspectorPanel} /> : null}</HStack> : null}
    <AppShell variant="elevated" sideNav={navigation.isCollapsed ? undefined : sidebar} mobileNav={{ breakpoint: 'none' }} height="fill"><VStack className="app-sheet" gap={0}>
      {characterEditor ? <VStack style={{ display: page === 'characters' ? 'flex' : 'none', height: '100%', minHeight: 0 }} gap={0}><PageBoundary name="character-editor"><CharacterEditor active={page === 'characters'} initial={characterEditor} state={state} catalog={catalog} settings={openSettings} apply={characterOrigin.current ? async saved => { const origin = characterOrigin.current!; await applyToTarget(saved, origin.draftId, origin.speakerId); setCharacterEditor(null); } : undefined} close={() => { setCharacterEditor(null); setPage(characterReturnPage.current); }} /></PageBoundary></VStack> : null}
      <VStack className="page-panel" style={{ display: characterActive ? 'none' : 'flex' }} gap={0}><Layout height="fill" footer={visited.has('create') ? <VStack gap={0} style={{ display: page === 'create' ? 'flex' : 'none' }}><PageBoundary name="timeline" resetKey={draft.id}><Suspense fallback={null}>{scoring ? <ScoreDock key={draft.id} active={createVisible} draft={draft} change={change} playhead={track ? playback : undefined} seek={time => setSeekRequest({ time, nonce: performance.now() })} /> : null}{draft.timeline || projectKind(draft) === 'story' ? <TimelineEditor exportProject={async () => { await persistDraft(draft); await call('project.export', { id: draft.id, name: draft.title }); }} key={draft.id} selectedCue={selectedCue} cueSelectionRevision={cueSelection?.revision ?? 0} playbackCue={setPlayingCue} selectCue={selectCue} draft={draft} busy={busy} regenerate={async (cueId, clipId) => { await persistDraft(draft); await call('generation.cue', { draft, cueId, clipId }); }} value={draft.timeline ?? { tracks: [] }} history={state.history} drafts={projectList} change={timeline => change({ timeline })} suspended={page !== 'create' || voicePicker !== null || characterActive || !!voiceEditor || !!voiceTarget} onError={onError} /> : <Player onProgress={(time, playing) => { reportPlayhead(time); if (scoring) setPlayback({ time, playing }); }} seekRequest={scoring ? seekRequest : undefined} actions={playerActions} versions={versionSwitch} reveal={false} suspended={page !== 'create' || voicePicker !== null || characterActive || !!voiceEditor || !!voiceTarget || !!nowPlaying} track={track} onError={onError} />}</Suspense></PageBoundary></VStack> : null} content={<VStack className="content-frame" gap={0}>
        {!ready ? <p className="loading" role="status">{t('@yovoice.app.loading')}</p> : <>

          {visited.has('create') ? <VStack className="page-panel" gap={0} style={{ display: page === 'create' ? 'flex' : 'none' }}><PageBoundary name="create" resetKey={draft.id}>
            <Studio showInspector={showInspector} inspector={inspector} inspectorCollapsed={inspectorCollapsed} resizeInspector={inspectorPanel.props} collapsedAction={collapsedAction}
          title={<input className="document-title" aria-label={t('@yovoice.app.titleLabel')} maxLength={120} value={draft.title} onChange={e => change({ title: e.target.value })} />}
          writingClassName={`${draft.subtitles ? 'writing-subtitles' : ''} ${draft.timeline ? 'writing-timeline' : ''} ${scoring ? 'writing-score' : ''}`.trim()}>
          <Suspense fallback={<p role="status">{t('@yovoice.app.loading')}</p>}>{scoring ? <><ScoreEditor key={draft.id} active={createVisible} draft={draft} change={change} previewTracks={() => setStudio({ kind: 'midi', projectId: draft.id })} locale={state.preferences.uiLocale} onError={onError} />{editorFooter()}</> : soundEffects ? <><SfxEditor key={draft.id} draft={draft} change={change} />{editorFooter()}</> : music ? <><MusicEditor key={draft.id} active={createVisible} draft={draft} state={state} change={change} locale={state.preferences.uiLocale} onError={onError} />{editorFooter()}</> : draft.subtitles ? <SubtitleEditor key={draft.id} active={createVisible} busy={busy} onError={onError} regenerate={async (cueId, clipId) => { await persistDraft(draft); await call('generation.cue', { draft, cueId, clipId }); }} history={state.history} playingCue={playingCue} failedCue={activity?.projectId === draft.id && activity.status === 'failed' ? activity.cueId : undefined} draft={draft} characters={state.characters ?? []} change={change} selectedCue={selectedCue} selectCue={selectCue} renderFooter={editorFooter} /> : <><textarea ref={editor} className="script-editor" aria-label={t('@yovoice.app.scriptLabel')} placeholder={t('@yovoice.app.scriptPlaceholder')} maxLength={12000} value={draft.text} spellCheck={false} dir={draft.language === 'ar' ? 'rtl' : 'auto'} onChange={e => change({ text: e.target.value })} />{editorFooter()}</>}</Suspense>
        </Studio>
          </PageBoundary></VStack> : null}
          {(['story', 'music', 'score', 'sfx'] as const).filter(kind => visited.has(kind)).map(kind => <VStack key={kind} id={`projects-${kind}-panel`} className="page-panel" gap={0} style={{ display: page === kind ? 'flex' : 'none' }}><PageBoundary name={`projects-${kind}`}>
            <Projects onError={onError} kind={kind} coverOf={item => state.history.find(entry => entry.settings.id === item.id && !entry.stemOf && projectKind(entry.settings) === 'music')} title={kind === 'story' ? undefined : t('@yovoice.project.music')} controls={kind === 'story' ? undefined : musicTabs} drafts={projectList} open={selectDraft} history={openHistory} create={kind === 'story' ? <HStack gap={2} vAlign="center"><Suspense fallback={null}><BookImport active={page === 'story'} state={state} modelId={defaultModelId} configureAI={() => openSettings(defaultModelId, 'ai')} create={importBook} onError={onError} /></Suspense><NewProject kind={kind} locale={state.preferences.uiLocale} modelId={defaultModelId} modelFor={modelFor} create={newDraft} onError={onError} /></HStack> : <NewProject kind={kind} locale={state.preferences.uiLocale} modelId={defaultModelId} modelFor={modelFor} create={newDraft} onError={onError} />} copy={item => run(() => newDraft({ ...structuredClone(item), id: newId(), title: (item.title + t('@yovoice.draft.copySuffix')).slice(0, 120), createdAt: undefined, updatedAt: undefined }))} remove={setDeleteTarget} save={async next => { await persistDraft(draft); await persistDraft(next); if (next.id === draft.id) setDraft(next); }} />
          </PageBoundary></VStack>)}
          {visited.has('characters') ? <VStack id="voice-library-panel" className="page-panel" gap={0} style={{ display: page === 'characters' ? 'flex' : 'none' }}><PageBoundary name="characters">
            <CharacterLibrary controls={libraryTabs} active={page === 'characters' && !voiceTarget && !characterActive} create={createVoice} state={state} catalog={catalog} edit={editCharacter} apply={setVoiceTarget} onError={onError} />
          </PageBoundary></VStack> : null}
          {visited.has('transcribe') ? <VStack id="transcribe-panel" className="page-panel" gap={0} style={{ display: page === 'transcribe' ? 'flex' : 'none' }}><PageBoundary name="transcribe">
            <Suspense fallback={<p className="loading" role="status">{t('@yovoice.app.loading')}</p>}><TranscribePage state={state} active={page === 'transcribe'} openSettings={() => openSettings('qwen3-asr-0.6b-q8')} /></Suspense>
          </PageBoundary></VStack> : null}
          {visited.has('settings') ? <VStack className="page-panel" gap={0} style={{ display: page === 'settings' ? 'flex' : 'none' }}>
            <PageBoundary name="settings"><Suspense fallback={<p role="status">{t('@yovoice.app.loadingSettings')}</p>}><Settings focus={settingsFocus} state={state} catalog={catalog} engine={engine} draft={draft} run={run} active={page === 'settings'} onError={onError}
              openProject={id => { const item = state.drafts.find(d => d.id === id); if (item) selectDraft(item); }} /></Suspense></PageBoundary>
          </VStack> : null}
          {(['voices', 'history'] as const).filter(destination => visited.has(destination)).map(destination => <VStack key={destination} id={destination === 'voices' ? 'reference-library-panel' : undefined} className="page-panel" gap={0} style={{ display: page === destination ? 'flex' : 'none' }}><PageBoundary name={destination}>
            <MediaLibrary page={destination} project={draft} controls={destination === 'voices' ? libraryTabs : <HStack gap={2} vAlign="center">
              <Button size="sm" label={t('@yovoice.history.backProject')} tooltip={withHotkey(t('@yovoice.history.backProject'), backKeys, undefined)} aria-keyshortcuts={backAria} onClick={() => { setPreviewTrack(null); setPage('create'); }} />
            </HStack>} state={state}
              query={destination === 'voices' ? voiceQuery : historyQuery} onQueryChange={destination === 'voices' ? setVoiceQuery : setHistoryQuery}
              track={page === destination ? previewTrack : null} audition={audition} stop={() => setPreviewTrack(null)} suspended={page !== destination || voicePicker !== null || !!voiceEditor || !!nowPlaying}
              addVoice={() => setVoicePicker('add')} editVoice={setVoiceEditor} exportCaptions={setCaptionTarget} saveCharacter={characterFromGeneration} onError={onError}
              reuse={reuseGeneration} exportItem={exportVersion} share={setShareTarget} play={setNowPlaying} separate={separateStems} transcribe={transcribeMidi} openStems={openStems} resing={item => canResing(item) ? () => resing(item) : undefined} />
          </PageBoundary></VStack>)}
        </>}

      </VStack>} /></VStack>
    </VStack></AppShell>
    {ready && !assistantHidden ? <PageBoundary name="assistant"><Suspense fallback={null}><AssistantDock state={state} open={assistantOpen} setOpen={setAssistantOpen} context={{ ...assistantContext, page: assistantContext.page === 'create' ? 'text' : assistantContext.page }} expanded={assistantExpanded} quickActions={quickActions(t, assistantPage === 'create' ? 'text' : assistantPage)} onToggleExpand={() => setAssistantExpanded(expanded => !expanded)} actions={askAssistantPanel} launcherHidden={launcherHidden} showLauncher={showLauncher} nudge={nudge} onNudge={actOnNudge} dismissNudge={dismissNudge} /></Suspense></PageBoundary> : null}
    {shareTarget ? <PageBoundary name="community-share"><ShareDialog generation={shareTarget} name={shareTarget.settings.title.trim() || versionName(shareTarget)} community={state.community} onClose={() => setShareTarget(null)} /></PageBoundary> : null}
    {exportTarget ? <PageBoundary name="version-export"><VersionExportDialog generation={exportTarget} name={versionName(exportTarget)} tags={exportTags(exportTarget)} onClose={() => setExportTarget(null)} /></PageBoundary> : null}
    {studio ? <PageBoundary name="stem-studio"><Suspense fallback={null}><StemStudio target={studio} history={state.history} project={studio.kind === 'midi' ? (studio.projectId === draft.id ? draft : state.drafts.find(item => item.id === studio.projectId)) : undefined}
      onClose={() => setStudio(null)} onExport={exportStems} onResplit={source => separateStems(source, true)} onDeleteStems={deleteStems} busy={busy} openSoundFonts={() => { setStudio(null); openSettings('musescore-general-sf2'); }} /></Suspense></PageBoundary> : null}
    {captionTarget ? <PageBoundary name="caption-export"><CaptionDialog state={state} generation={captionTarget} name={versionName(captionTarget)} onClose={() => setCaptionTarget(null)} /></PageBoundary> : null}
    {creator.input}
    <PageBoundary name="hotkey-cheatsheet"><HotkeyCheatsheet page={page} disabled={!!state.preferences.hotkeys?.disabled} customize={() => openSettings(undefined, 'hotkeys')} /></PageBoundary>
    <WorkbenchOverlays state={state} catalog={catalog} ready={ready} error={error} setError={setError} page={page} run={run} session={session} selectDraft={selectDraft} instrumental={instrumental} voicePicker={voicePicker} setVoicePicker={setVoicePicker} editor={editor} pronunciation={pronunciation} setPronunciation={setPronunciation} voiceTarget={voiceTarget} setVoiceTarget={setVoiceTarget} projectList={projectList} applyToTarget={applyToTarget} nowPlaying={nowPlaying} setNowPlaying={setNowPlaying} openSettings={openSettings} voiceEditor={voiceEditor} setVoiceEditor={setVoiceEditor} cues={cues} showIntro={showIntro} finishIntro={finishIntro} showTour={showTour} finishTour={finishTour} />
  </VStack>;
}
