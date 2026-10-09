import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { useResizable, ResizeHandle } from '@astryxdesign/core/Resizable';
import { AppShell } from '@astryxdesign/core/AppShell';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { NewProject, Projects } from '../features/library/projects';
import { VoiceTarget } from '../features/library/voice-target';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack, Layout } from '@astryxdesign/core/Layout';
import { Selector } from '../shared/selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { AppDialog, ConfirmDelete } from '../shared/ui/app-dialog';
import { Studio } from '../features/create/studio';
import { MediaLibrary } from '../features/library/media-library';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { AudioLines, Mic, PanelLeft, Pencil, ChevronRight, Settings2, Check, X, Plus, Trash2, CircleAlert } from 'lucide-react';
import { call, subscribe, isDesktop } from '../shared/lib/client';
import { isKokoroModel, isReferenceModel, isVoxModel, requiresVoice, projectKind, createDraft, emptyState, formatSize, type Activity, type Draft, type State, type ModelPackage, type Voice, type Generation, type Track } from '../shared/workbench';
import { CharacterEditor, CharacterLibrary } from '../features/library/characters';
import { VoiceEditor } from '../features/library/voice-editor';
import { synthesisSettings, stableJSON, performanceSettings, cueSettings, type Character } from '../shared/workbench';
import { SubtitleImport, SubtitleEditor, SpeakerAvatar } from '../features/create/subtitles';
import { Inspector } from '../features/create/inspector';
const Settings = lazy(() => import('../features/settings/settings').then(module => ({ default: module.Settings })));
import { Timeline } from '../features/media/timeline';
import { withCueIds } from '../shared/workbench';
import { TimelineEditor } from '../features/media/timeline-editor';
import { Player } from '../features/media/player';
const VoicePicker = lazy(() => import('../features/media/voice-picker').then(module => ({ default: module.VoicePicker })));
import { SelectionAction, type TextSelection } from '../features/create/selection-action';
import { LocaleShell, ensureUiLocalePersisted, bootLocale } from './locale-shell';
import { isUiLocale } from '../shared/i18n/locale';
import { formatActivity, formatActivityError } from '../shared/i18n/format';
import { CallError } from '../shared/lib/call-error';

function errorMessage(error: unknown): string {
  if (error instanceof CallError && error.code === '@yovoice.error.unknown' && error.params.detail) return `${error.code}::${String(error.params.detail)}`;
  return error instanceof Error ? error.message : String(error);
}

function NoticeText({ error, activity }: { error: string; activity: Activity | null | undefined }) {
  const t = useTranslator();
  const [code, detail] = error.split('::', 2);
  if (code.startsWith('@yovoice.')) return <>{t(code)}{detail ? ` (${detail})` : null}</>;
  if (error) return <>{error}</>;
  return <>{formatActivityError(t, activity) ?? t('@yovoice.error.unknown')}</>;
}

function ActivityLabel({ activity }: { activity: Activity }) {
  const t = useTranslator();
  return <strong data-testid="activity-label">{formatActivity(t, activity)}</strong>;
}


function SidebarNav(props: {
  page: string;
  setPage: (id: string) => void;
  newDraft: ReactNode;
  state: State;
  draft: Draft;
  selectDraft: (item: Draft) => void;
  removeDraft: (item: Draft) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: { props: any };
}) {
  const t = useTranslator();
  const { page, setPage, newDraft, state, draft, selectDraft, removeDraft, navigation } = props;
  const [recentOpen, setRecentOpen] = useState(() => localStorage.getItem('yovoice-recent-open') !== 'false');
  const projectActive = page === 'create' || page === 'history';
  return <VStack as="nav" className="sidebar" aria-label={t('@yovoice.nav.main')} gap={6} data-testid="sidebar">
    {newDraft}
    <VStack className="sidebar-destinations" gap={2}>
      {(['story', 'text'] as const).map(kind => <Button key={kind} data-testid={`nav-${kind}`} label={t(`@yovoice.project.${kind}`)} variant="ghost" icon={kind === 'story' ? <Pencil /> : <Mic />} className={`nav-item ${page === kind || (projectActive && projectKind(draft) === kind) ? 'selected' : ''}`} aria-current={page === kind || (projectActive && projectKind(draft) === kind) ? 'page' : undefined} onClick={() => setPage(kind)} />)}
      <Button data-testid="nav-characters" label={t('@yovoice.nav.characters')} variant="ghost" icon={<AudioLines />} className={`nav-item ${page === 'characters' || page === 'voices' ? 'selected' : ''}`} aria-current={page === 'characters' || page === 'voices' ? 'page' : undefined} onClick={() => setPage('characters')} />
    </VStack>
    <details className="recent-projects" open={recentOpen}>
      <summary onClick={event => { event.preventDefault(); const open = !recentOpen; setRecentOpen(open); localStorage.setItem('yovoice-recent-open', String(open)); }}><ChevronRight aria-hidden />{t('@yovoice.nav.recent')}</summary>
      <VStack className="project-list" gap={1}>{[...state.drafts].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 5).map(item => <HStack key={item.id} className={`project-row ${item.id === draft.id && page === 'create' ? 'current' : ''}`} gap={0}>
        <Button label={item.id === draft.id ? draft.title : item.title} variant="ghost" size="sm" className="project-link grow" aria-current={item.id === draft.id && page === 'create' ? 'page' : undefined} onClick={() => selectDraft(item)} />
        <Button className="project-quick-delete" label={t('@yovoice.nav.deleteProject', { title: item.id === draft.id ? draft.title : item.title })} icon={<Trash2 />} isIconOnly size="sm" variant="ghost" onClick={() => removeDraft(item.id === draft.id ? draft : item)} />
      </HStack>)}</VStack>
    </details>
    <VStack className="sidebar-bottom" gap={3}><Button data-testid="nav-settings" label={t('@yovoice.nav.settings')} icon={<Settings2 size={18} />} variant="ghost" className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')} /></VStack>
    <ResizeHandle label={t('@yovoice.nav.resize')} direction="horizontal" position="overlay" pillPlacement="center" resizable={navigation.props} isAlwaysVisible={false} />
  </VStack>;
}

export function App() {
  const navigation = useResizable({ defaultSize: 224, minSize: 180, maxSize: 360, collapsible: true, autoSaveId: 'workbench-sidebar' });
  const toggleSidebar = useCallback(() => { if (navigation.isCollapsed) navigation.expand(); else navigation.collapse(); }, [navigation.isCollapsed, navigation.expand, navigation.collapse]);
  useEffect(() => {
    window.addEventListener('workbench-toggle-sidebar', toggleSidebar);
    return () => window.removeEventListener('workbench-toggle-sidebar', toggleSidebar);
  }, [toggleSidebar]);
  const previousVoices = useRef<Voice[]>([]);
  const [state, setState] = useState<State>(emptyState); const [catalog, setCatalog] = useState<ModelPackage[]>([]);
  const [draft, setDraft] = useState<Draft>(() => createDraft(true)); const [ready, setReady] = useState(false); const [draftPersisted, setDraftPersisted] = useState(true);
  const [page, setPage] = useState('create');
  const [saveFailed, setSaveFailed] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<{ tab: string; modelId: string; request: number } | undefined>();
  const openSettings = (modelId = draft.modelId, tab = 'models') => { setSettingsFocus({ tab, modelId, request: performance.now() }); setPage('settings'); }; const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [voicePicker, setVoicePicker] = useState<'voice' | 'emotion' | 'add' | null>(null);
  const [previewTrack, setPreviewTrack] = useState<Track | null>(null);
  const [track, setTrack] = useState<Track | null>(null); const [advanced, setAdvanced] = useState(false);
  const [pronunciation, setPronunciation] = useState<{ start: number; end: number; word: string; sound: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  useEffect(() => setDeleteError(''), [deleteTarget?.id]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
  const [showInspector, setShowInspector] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null); const saveSequence = useRef(0); const previousHistory = useRef<string | undefined>(undefined);
  const onError = useCallback((message: string) => setError(message), []);
  useEffect(() => {
    if (!isDesktop) return;
    const saved = localStorage.getItem('astryx-resizable:workbench-sidebar');
    if (saved) void call('sidebar.save', JSON.parse(saved)).catch(error => setError(error.message));
  }, [navigation.size, navigation.isCollapsed]);
  const run = useCallback((action: () => Promise<unknown>) => { void action().catch(e => setError(errorMessage(e))); }, []);
  useEffect(() => {
    const unsubscribe = subscribe(setState);
    void call<{ state: State; catalog: ModelPackage[] }>('state.get').then(async result => {
      let next = result.state;
      if (!isUiLocale(next.preferences.uiLocale)) {
        try {
          await ensureUiLocalePersisted(next.preferences, bootLocale);
          next = { ...next, preferences: { ...next.preferences, uiLocale: bootLocale } };
        } catch (e) { setError((e as Error).message); }
      }
      const defaultModelId = next.models[0]?.id ?? result.catalog[0]?.id ?? 'index-2.5-q8';
      const initial = next.drafts.find(d => d.id === localStorage.getItem('yovoice-active-project')) ?? next.drafts[0];
      setState(next); setCatalog(result.catalog); setDraft(withCueIds(initial ?? createDraft(true, next.preferences.uiLocale, defaultModelId))); setDraftPersisted(!!initial);
      setReady(true);
    }).catch(e => setError(e.message));
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!ready || deleting || !draftPersisted) return;
    window.__workbenchDraft = draft;
    localStorage.setItem('yovoice-active-project', draft.id);
    setSaving(true); setSaveFailed(false); const sequence = ++saveSequence.current;
    const timer = saveTimer.current = setTimeout(() => {
      pendingSave.current = pendingSave.current.catch(() => {}).then(() => call('draft.save', draft));
      void pendingSave.current.then(() => { if (sequence === saveSequence.current) setSaving(false); }).catch(e => { setSaveFailed(true); setSaving(false); setError(e.message); });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, ready, deleting, draftPersisted]);
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
  }, [state.voices, state.history, ready]);
  useEffect(() => { setPreviewTrack(null); setTrack(current => current ? { ...current, playRequest: undefined } : null); }, [page]);
  useEffect(() => { if (ready) setDraft(current => Timeline.accept(withCueIds(current), state.history)); }, [state.history, draft.id, ready]);
  const change = (patch: Partial<Draft>) => { setDraftPersisted(true); setDraft(current => withCueIds({ ...current, ...patch })); };
  const generate = () => {
    if (state.activity?.status === 'running') return;
    if (draft.subtitles) {
      const missing = draft.subtitles.speakers.map(s => ({ ...draft, ...s.settings })).find(d => !state.models.some(m => m.id === d.modelId));
      if (missing || !state.runtimePath || state.runtimeBackend !== state.preferences.backend) { openSettings(missing?.modelId ?? draft.modelId, missing ? 'models' : 'engine'); return; }
      run(async () => { await persistDraft(draft); await call('generation.start', draft); }); return;
    }
    if (requiresVoice(draft) && !state.voices.some(voice => voice.id === draft.voiceId)) { setVoicePicker('voice'); return; }
    if (!state.runtimePath || state.runtimeBackend !== state.preferences.backend || !state.models.some(m => m.id === draft.modelId)) {
      openSettings(draft.modelId, !state.models.some(m => m.id === draft.modelId) ? 'models' : 'engine'); return;
    }
    run(async () => { await persistDraft(draft); await call('generation.start', draft); });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && page === 'create' && !Array.from(document.querySelectorAll('[role=dialog], [data-character-active=true]')).some(e => e.getClientRects().length > 0)) { event.preventDefault(); generate(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  async function persistDraft(next: Draft) {
    clearTimeout(saveTimer.current); const sequence = ++saveSequence.current;
    setSaving(true); setSaveFailed(false);
    pendingSave.current = pendingSave.current.catch(() => {}).then(() => call('draft.save', next));
    try { await pendingSave.current; setDraftPersisted(true); if (sequence === saveSequence.current) setSaving(false); }
    catch (error) { setSaving(false); setSaveFailed(true); throw error; }
  }
  async function newDraft(next: Draft) {
    if (draftPersisted) await persistDraft(draft); await persistDraft(next);
    setDraft(withCueIds(next)); setPage('create');
  }
  function selectDraft(item: Draft) { run(async () => { if (draftPersisted) await persistDraft(draft); setDraft(withCueIds(item.id === draft.id ? draft : item)); setDraftPersisted(true); setPage('create'); }); }
  async function deleteDraft() {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setDeleteError(''); clearTimeout(saveTimer.current); ++saveSequence.current;
    try {
      // 等待已发出的保存，再切换当前作品，避免删除后被延迟保存恢复。
      await pendingSave.current.catch(() => {});
      if (deleteTarget.id === draft.id) {
        const next = state.drafts.find(item => item.id !== draft.id);
        const replacement = next ?? createDraft(false, state.preferences.uiLocale, state.models[0]?.id ?? 'index-2.5-q8');
        window.__workbenchDraft = replacement; setDraft(replacement); setDraftPersisted(!!next);
        if (next) await call('draft.save', next);
      }
      await call('draft.delete', { id: deleteTarget.id });
      setDeleteTarget(null);
    } catch (error) {
      const message = errorMessage(error);
      setDeleteError(message.startsWith('@yovoice.error.unknown::') ? message.slice('@yovoice.error.unknown::'.length) : message);
    }
    finally { setDeleting(false); }
  }
  function selectVoice(voice: Voice) { if (voicePicker !== 'add') change(voicePicker === 'emotion' ? { emotionVoiceId: voice.id } : { voiceId: voice.id, referenceText: voice.referenceText ?? '' }); setVoicePicker(null); }
  function annotate(selection: TextSelection) {
    setPronunciation({ ...selection, sound: '' });
  }
  const generations = state.history.filter(item => item.settings.id === draft.id);
  const activity = state.activity; const busy = activity?.status === 'running';
  return <LocaleShell preferencesLocale={state.preferences.uiLocale}>
    <WorkbenchChrome
      navigation={navigation}
      toggleSidebar={toggleSidebar}
      state={state}
      catalog={catalog}
      draft={draft}
      setDraft={setDraft}
      draftPersisted={draftPersisted}
      setDraftPersisted={setDraftPersisted}
      ready={ready}
      page={page}
      setPage={setPage}
      error={error}
      setError={setError}
      saving={saving}
      saveFailed={saveFailed}
      persistDraft={persistDraft}
      openSettings={openSettings}
      settingsFocus={settingsFocus}
      voicePicker={voicePicker}
      setVoicePicker={setVoicePicker}
      previewTrack={previewTrack}
      setPreviewTrack={setPreviewTrack}
      track={track}
      setTrack={setTrack}
      advanced={advanced}
      setAdvanced={setAdvanced}
      pronunciation={pronunciation}
      setPronunciation={setPronunciation}
      deleteTarget={deleteTarget}
      setDeleteTarget={setDeleteTarget}
      deleting={deleting}
      deleteError={deleteError}
      showInspector={showInspector}
      setShowInspector={setShowInspector}
      editor={editor}
      previousHistory={previousHistory}
      onError={onError}
      run={run}
      change={change}
      generate={generate}
      newDraft={newDraft}
      selectDraft={selectDraft}
      deleteDraft={deleteDraft}
      selectVoice={selectVoice}
      annotate={annotate}
      generations={generations}
      activity={activity}
      busy={busy}
    />
  </LocaleShell>;
}

function WorkbenchChrome(props: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: { props: any; size: number; isCollapsed: boolean };
  toggleSidebar: () => void;
  state: State;
  catalog: ModelPackage[];
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  draftPersisted: boolean;
  setDraftPersisted: (persisted: boolean) => void;
  ready: boolean;
  page: string;
  setPage: (id: string) => void;
  error: string;
  setError: (message: string) => void;
  saving: boolean;
  openSettings: (modelId?: string, tab?: string) => void;
  settingsFocus?: { tab: string; modelId: string; request: number };
  saveFailed: boolean;
  persistDraft: (draft: Draft) => Promise<void>;
  voicePicker: 'voice' | 'emotion' | 'add' | null;
  setVoicePicker: (value: 'voice' | 'emotion' | 'add' | null) => void;
  previewTrack: Track | null;
  setPreviewTrack: React.Dispatch<React.SetStateAction<Track | null>>;
  track: Track | null;
  setTrack: React.Dispatch<React.SetStateAction<Track | null>>;
  advanced: boolean;
  setAdvanced: (value: boolean) => void;
  pronunciation: { start: number; end: number; word: string; sound: string } | null;
  setPronunciation: React.Dispatch<React.SetStateAction<{ start: number; end: number; word: string; sound: string } | null>>;
  deleteTarget: Draft | null;
  setDeleteTarget: (item: Draft | null) => void;
  deleting: boolean;
  deleteError: string;
  showInspector: boolean;
  setShowInspector: (value: boolean) => void;
  editor: React.RefObject<HTMLTextAreaElement | null>;
  previousHistory: React.MutableRefObject<string | undefined>;
  onError: (message: string) => void;
  run: (action: () => Promise<unknown>) => void;
  change: (patch: Partial<Draft>) => void;
  generate: () => void;
  newDraft: (draft: Draft) => Promise<void>;
  selectDraft: (item: Draft) => void;
  deleteDraft: () => Promise<void>;
  selectVoice: (voice: Voice) => void;
  annotate: (selection: TextSelection) => void;
  generations: Generation[];
  activity: Activity | null;
  busy: boolean;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const {
    navigation, toggleSidebar, state, catalog, draft, setDraft, draftPersisted, setDraftPersisted, ready, page, setPage,
    error, setError, saving, saveFailed, persistDraft, openSettings, settingsFocus, voicePicker, setVoicePicker, previewTrack, setPreviewTrack, track, setTrack,
    advanced, setAdvanced, pronunciation, setPronunciation, deleteTarget, setDeleteTarget, deleting, deleteError,
    showInspector, setShowInspector, editor, previousHistory, onError, run, change, generate, newDraft,
    selectDraft, deleteDraft, selectVoice, annotate, generations, activity, busy,
  } = props;
  const [playingCue, setPlayingCue] = useState(-1);
  const [cueSelection, setCueSelection] = useState<{ draftId: string; index: number; revision: number } | null>(null);
  const selectedCue = cueSelection?.draftId === draft.id ? Math.min(cueSelection.index, (draft.subtitles?.cues.length ?? 1) - 1) : 0;
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
  const [dismissedActivity, setDismissedActivity] = useState(() => localStorage.getItem('yovoice-dismissed-task') ?? '');
  const activityKey = activity ? stableJSON(activity) : '';
  const projectList = state.drafts.map(d => d.id === draft.id ? { ...draft, createdAt: d.createdAt, updatedAt: d.updatedAt } : d);
  const [voiceQuery, setVoiceQuery] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const openHistory = (item: Draft) => run(async () => { if (draftPersisted) await persistDraft(draft); setDraft(withCueIds(item)); setDraftPersisted(true); setHistoryQuery(''); setPreviewTrack(null); setPage('history'); });
  const [characterEditor, setCharacterEditor] = useState<Character | null>(null);
  const characterActive = !!characterEditor && page === 'characters';
  const characterReturnPage = useRef('create');
  const characterOrigin = useRef<{ draftId: string; speakerId: string } | null>(null);
  const [voiceEditor, setVoiceEditor] = useState<Voice | Generation | null>(null);
  const selectedCharacter = draft.characterId ?? null;
  const applyCharacter = (c: Character) => {
    if (activeSpeaker) {
      setDraft(current => ({ ...current, subtitles: { ...current.subtitles!, cues: current.subtitles!.cues.map(cue => cue.speakerId === activeSpeaker.id ? { ...cue, performance: undefined } : cue), speakers: current.subtitles!.speakers.map(s => s.id === activeSpeaker.id ? { ...s, characterId: c.id, settings: structuredClone(c.settings) } : s) } }));
    } else { change({ ...c.settings, characterId: c.id, performance: undefined }); }
  };
  const editCharacter = (character: Character) => { if (characterEditor) { setPage('characters'); return; } characterOrigin.current = page === 'create' ? { draftId: draft.id, speakerId: activeSpeaker?.id ?? '' } : null; characterReturnPage.current = page; setCharacterEditor(character); setPage('characters'); };
  const openCharacter = () => {
    editCharacter({ id: crypto.randomUUID().replaceAll('-', ''), name: activeSpeaker?.sourceName || draft.title, settings: synthesisSettings(inspectorDraft), demoText: t('@yovoice.character.example') });
  };
  const createVoice = () => {
    const defaults = createDraft(false, state.preferences.uiLocale);
    editCharacter({ id: crypto.randomUUID().replaceAll('-', ''), name: t('@yovoice.library.newVoice'), settings: synthesisSettings({ ...defaults, modelId: 'omnivoice-q8', voiceMode: 'design' }), demoText: t('@yovoice.character.example') });
  };
  async function applyToTarget(voice: Character, draftId: string, speakerId: string) {
    const source = draftId === 'new' ? { ...createDraft(false, state.preferences.uiLocale), kind: 'text' as const } : projectList.find(d => d.id === draftId);
    if (!source || (source.subtitles && !source.subtitles.speakers.some(s => s.id === speakerId))) throw new Error('@yovoice.error.draftIDInvalid');
    const next = source.subtitles ? { ...source, subtitles: { ...source.subtitles, cues: source.subtitles.cues.map(cue => cue.speakerId === speakerId ? { ...cue, performance: undefined } : cue), speakers: source.subtitles.speakers.map(s => s.id === speakerId ? { ...s, characterId: voice.id, settings: structuredClone(voice.settings) } : s) } } : { ...source, ...structuredClone(voice.settings), characterId: voice.id, performance: undefined };
    if (draftId === draft.id) { await persistDraft(next); setDraft(withCueIds(next)); setPage('create'); }
    else await newDraft(next);
    if (next.subtitles) setCueSelection(current => ({ draftId: next.id, index: Math.max(0, next.subtitles!.cues.findIndex(c => c.speakerId === speakerId)), revision: (current?.revision ?? 0) + 1 }));
  }
  const libraryTabs = <TabList value={page === 'voices' ? 'voices' : 'characters'} onChange={setPage} role="tablist" hasDivider>
    <Tab value="characters" label={t('@yovoice.library.voicesTab')} panelId="voice-library-panel" />
    <Tab value="voices" label={t('@yovoice.library.referencesTab')} panelId="reference-library-panel" />
  </TabList>;

  useEffect(() => {
    if (!ready) return;
    const latest = state.history.find(item => item.settings.id === draft.id);
    const key = `${draft.id}/${latest?.id ?? ''}`;
    if (key !== previousHistory.current) setTrack(latest ? { id: latest.id, name: latest.title, fileName: latest.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput') } : null);
    previousHistory.current = key;
  }, [draft.id, state.history, ready, t, previousHistory, setTrack]);

  function selectGeneration(item: Generation) {
    setTrack({ id: item.id, name: item.title, fileName: item.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput') });
  }
  const audition = (value: Track) => {
    if (page === 'create') setTrack({ ...value, playRequest: performance.now() });
    else setPreviewTrack(current => current?.id === value.id ? null : { ...value, playRequest: performance.now() });
  };
  const dateOpts: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  const editorFooter = (controls?: ReactNode) => <HStack className="editor-status" hAlign="between" vAlign="center" gap={2} wrap="wrap"><HStack gap={1} vAlign="center">{projectKind(draft) === 'story' ? <SubtitleImport onError={onError} onImport={async (title, subtitles) => { await newDraft({ ...createDraft(false, state.preferences.uiLocale), ...synthesisSettings(draft), kind: 'story', title, text: subtitles.cues.map(c => c.text).join('\n'), subtitles }); }} /> : null}{controls}</HStack><HStack vAlign="center" gap={4}><small className="saved"><Check size={14} />{saveFailed ? <Button size="sm" label={t('@yovoice.app.saveFailed')} onClick={() => run(() => persistDraft(draft))} /> : saving ? t('@yovoice.app.saving') : t('@yovoice.app.saved')}</small><small>{t('@yovoice.app.charCount', { count: Array.from(draft.text).length })}</small></HStack></HStack>;
  const defaultModelId = state.models[0]?.id ?? 'index-2.5-q8';
  const sidebar = <SidebarNav page={page} setPage={setPage} newDraft={<NewProject locale={state.preferences.uiLocale} modelId={defaultModelId} create={newDraft} onError={onError} button={{ 'data-testid': 'nav-new', className: 'new-project', width: '100%', size: 'md' }} />} state={state} draft={draft} selectDraft={selectDraft} removeDraft={setDeleteTarget} navigation={navigation} />;
  const currentCharacter = state.characters.find(c => c.id === (activeSpeaker?.characterId ?? selectedCharacter));
  const currentPerformance = activeSpeaker ? activeCue?.performance : draft.performance;
  const performances = currentCharacter?.performances ?? [];
  const inspector = <Inspector libraryActions={<VStack gap={2}>
    {activeSpeaker ? <HStack gap={2} vAlign="center"><SpeakerAvatar seed={activeSpeaker.characterId ?? `${draft.id}:${activeSpeaker.id}`} /><h3>{activeSpeaker.sourceName || t('@yovoice.subtitle.speaker', { n: draft.subtitles!.speakers.indexOf(activeSpeaker) + 1 })}</h3></HStack> : null}
    <Selector label={t('@yovoice.character.choose')} isLabelHidden placeholder={t('@yovoice.character.choose')} value={activeSpeaker?.characterId ?? selectedCharacter ?? ''}
      options={[...state.characters.map(c => ({ value: c.id, label: c.name })), ...(state.characters.length ? [{ type: 'divider' as const }] : []), { value: 'new-voice', label: t('@yovoice.character.new'), icon: Plus }]}
      onChange={id => { if (id === 'new-voice') { createVoice(); return; } const voice = state.characters.find(c => c.id === id); if (voice) applyCharacter(voice); }} />
    {performances.length || currentPerformance ? <Selector label={t('@yovoice.performance.label')} value={currentPerformance?.id ?? ''}
      options={[{ value: '', label: t('@yovoice.performance.default'), disabled: !activeSpeaker && !currentCharacter }, ...performances.map(p => ({ value: p.id, label: p.name })), ...(currentPerformance && !performances.some(p => p.id === currentPerformance.id) ? [{ value: currentPerformance.id, label: currentPerformance.name }] : [])]}
      onChange={id => {
        const performance = structuredClone(performances.find(p => p.id === id));
        if (activeSpeaker) setDraft(current => ({ ...current, subtitles: { ...current.subtitles!, cues: current.subtitles!.cues.map((cue, index) => index === selectedCue ? { ...cue, performance } : cue) } }));
        else if (currentCharacter) change({ ...performanceSettings(currentCharacter.settings, performance), performance });
      }} /> : null}
  </VStack>} catalog={catalog} close={() => setShowInspector(false)} draft={inspectorDraft} state={state} change={changeSpeaker} chooseVoice={() => setVoicePicker('voice')} chooseEmotion={() => setVoicePicker('emotion')} play={audition} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => openSettings(inspectorDraft.modelId)} advanced={advanced} setAdvanced={setAdvanced} />;
  return <VStack className={`workbench ${isDesktop ? 'desktop' : 'preview'}`} style={{ '--app-nav': `${navigation.size}px` } as CSSProperties} gap={0}>
    {!isDesktop ? <HStack as="header" className="browser-titlebar" gap={2} vAlign="center"><Button label={navigation.isCollapsed ? t('@yovoice.app.expandSidebar') : t('@yovoice.app.collapseSidebar')} isIconOnly variant="ghost" size="sm" icon={<PanelLeft size={17} />} aria-expanded={!navigation.isCollapsed} onClick={toggleSidebar} /><b>yovoice</b><small>{t('@yovoice.app.browserPreview')}</small></HStack> : null}
    <AppShell variant="surface" sideNav={navigation.isCollapsed ? undefined : sidebar} mobileNav={{ breakpoint: 'none' }} height="fill">
      {characterEditor ? <VStack style={{ display: page === 'characters' ? 'flex' : 'none', height: '100%', minHeight: 0 }} gap={0}><CharacterEditor active={page === 'characters'} initial={characterEditor} state={state} catalog={catalog} settings={openSettings} apply={characterOrigin.current ? async saved => { const origin = characterOrigin.current!; await applyToTarget(saved, origin.draftId, origin.speakerId); setCharacterEditor(null); } : undefined} close={() => { setCharacterEditor(null); setPage(characterReturnPage.current); }} /></VStack> : null}
      <VStack className="page-panel" style={{ display: characterActive ? 'none' : 'flex' }} gap={0}><Layout height="fill" footer={<VStack gap={0} style={{ display: page === 'create' ? 'flex' : 'none' }}>{draft.timeline || projectKind(draft) === 'story' ? <TimelineEditor exportProject={async () => { await persistDraft(draft); await call('project.export', { id: draft.id, name: draft.title }); }} key={draft.id} selectedCue={selectedCue} cueSelectionRevision={cueSelection?.revision ?? 0} playbackCue={setPlayingCue} selectCue={selectCue} draft={draft} busy={busy} regenerate={async (cueId, clipId) => { await persistDraft(draft); await call('generation.cue', { draft, cueId, clipId }); }} value={draft.timeline ?? { tracks: [] }} history={state.history} change={timeline => change({ timeline })} suspended={page !== 'create' || voicePicker !== null || characterActive || !!voiceEditor || !!voiceTarget} onError={onError} /> : <Player laneActions={<Button size="sm" variant="secondary" icon={<Plus />} label={t('@yovoice.timeline.add')} onClick={() => { const source = state.history.find(g => g.id === track?.id); change({ timeline: { tracks: [{ id: crypto.randomUUID(), name: t('@yovoice.timeline.track', { n: 1 }), muted: false, clips: source ? [{ id: crypto.randomUUID(), generationId: source.id, start: 0, offset: 0, duration: source.duration }] : [] }, ...(source ? [{ id: crypto.randomUUID(), name: t('@yovoice.timeline.track', { n: 2 }), muted: false, clips: [] }] : [])] } }); }} />} actions={<Button label={t('@yovoice.character.saveAs')} size="sm" onClick={() => openCharacter()} />} suspended={page !== 'create' || voicePicker !== null || characterActive || !!voiceEditor || !!voiceTarget} track={track} onError={onError} historyControl={projectKind(draft) === 'text' && generations.length ? <HStack gap={1} vAlign="center">
        <Selector width="100%" label={t('@yovoice.app.historyVersions')} isLabelHidden size="sm" variant="ghost" isDisabled={busy} value={track?.kind === 'outputs' ? track.id : undefined} placeholder={t('@yovoice.app.historyPlaceholder')} options={generations.map((item, index) => ({ value: item.id, label: t('@yovoice.app.historyVersion', { n: generations.length - index }), description: <small className="history-version-date">{new Date(item.createdAt).toLocaleString(locale, dateOpts)}</small> }))} renderValue={option => option.label} onChange={id => { const item = generations.find(item => item.id === id); if (item) selectGeneration(item); }} />
      </HStack> : undefined} />}</VStack>} content={<VStack className="content-frame" gap={0}>
        {!ready ? <p className="loading" role="status">{t('@yovoice.app.loading')}</p> : <>

          <VStack className="page-panel" gap={0} style={{ display: page === 'create' ? 'flex' : 'none' }}>
            <Studio showInspector={showInspector} onShowInspector={() => setShowInspector(!showInspector)} inspector={inspector}
          title={<input className="document-title" aria-label={t('@yovoice.app.titleLabel')} maxLength={120} value={draft.title} onChange={e => change({ title: e.target.value })} />}
          writingClassName={`${draft.subtitles ? 'writing-subtitles' : ''} ${draft.timeline ? 'writing-timeline' : ''}`}>
          {draft.subtitles ? <SubtitleEditor key={draft.id} history={state.history} playingCue={playingCue} failedCue={activity?.projectId === draft.id && activity.status === 'failed' ? activity.cueId : undefined} draft={draft} characters={state.characters ?? []} change={change} selectedCue={selectedCue} selectCue={selectCue} renderFooter={editorFooter} /> : <><textarea ref={editor} className="script-editor" aria-label={t('@yovoice.app.scriptLabel')} placeholder={t('@yovoice.app.scriptPlaceholder')} maxLength={12000} value={draft.text} spellCheck={false} dir={draft.language === 'ar' ? 'rtl' : 'auto'} onChange={e => change({ text: e.target.value })} />{editorFooter()}</>}
        </Studio>
          </VStack>
          {(['story', 'text'] as const).map(kind => <VStack key={kind} className="page-panel" gap={0} style={{ display: page === kind ? 'flex' : 'none' }}>
            <Projects onError={onError} kind={kind} drafts={projectList} open={selectDraft} history={openHistory} create={<NewProject kind={kind} locale={state.preferences.uiLocale} modelId={defaultModelId} create={newDraft} onError={onError} />} copy={item => run(() => newDraft({ ...structuredClone(item), id: crypto.randomUUID().replaceAll('-', ''), title: (item.title + t('@yovoice.draft.copySuffix')).slice(0, 120), createdAt: undefined, updatedAt: undefined }))} remove={setDeleteTarget} save={async next => { await persistDraft(draft); await persistDraft(next); if (next.id === draft.id) setDraft(next); }} />
          </VStack>)}
          <VStack id="voice-library-panel" className="page-panel" gap={0} style={{ display: page === 'characters' ? 'flex' : 'none' }}>
            <CharacterLibrary controls={libraryTabs} active={page === 'characters' && !voiceTarget && !characterActive} create={createVoice} state={state} catalog={catalog} edit={editCharacter} apply={setVoiceTarget} onError={onError} />
          </VStack>
          <VStack className="page-panel" gap={0} style={{ display: page === 'settings' ? 'flex' : 'none' }}>
            <Suspense fallback={<p role="status">{t('@yovoice.app.loadingSettings')}</p>}><Settings focus={settingsFocus} state={state} catalog={catalog} draft={draft} run={run} /></Suspense>
          </VStack>
          {(['voices', 'history'] as const).map(destination => <VStack key={destination} id={destination === 'voices' ? 'reference-library-panel' : undefined} className="page-panel" gap={0} style={{ display: page === destination ? 'flex' : 'none' }}>
            <MediaLibrary page={destination} project={draft} controls={destination === 'voices' ? libraryTabs : <HStack gap={2} vAlign="center">
              <Button size="sm" label={t('@yovoice.history.backProject')} onClick={() => { setPreviewTrack(null); setPage('create'); }} />
            </HStack>} state={state}
              query={destination === 'voices' ? voiceQuery : historyQuery} onQueryChange={destination === 'voices' ? setVoiceQuery : setHistoryQuery}
              track={page === destination ? previewTrack : null} audition={audition} stop={() => setPreviewTrack(null)} suspended={page !== destination || voicePicker !== null || !!voiceEditor}
              addVoice={() => setVoicePicker('add')} editVoice={setVoiceEditor} onError={onError}
              reuse={item => run(() => newDraft({ ...structuredClone(item.settings), id: crypto.randomUUID().replaceAll('-', ''), title: (item.title + t('@yovoice.draft.copySuffix')).slice(0, 120), createdAt: undefined, updatedAt: undefined }))} />
          </VStack>)}
        </>}

      </VStack>} /></VStack>
    </AppShell>
    <VStack className="notifications" gap={2}>
        {error || (activity?.status === 'failed' && !activity.characterId && (!activity.projectId || activity.projectId === draft.id) && page === 'create' && activityKey !== dismissedActivity) ? <HStack className="notice" role="alert" gap={3} hAlign="between" vAlign="center"><CircleAlert className="notice-icon" aria-hidden /><p className="grow"><NoticeText error={error} activity={activity} /></p><Button label={t('@yovoice.action.closeNotice')} size="sm" variant="ghost" isIconOnly icon={<X size={16} />} onClick={() => { setError(''); if (activity?.status === 'failed') { setDismissedActivity(activityKey); localStorage.setItem('yovoice-dismissed-task', activityKey); } }} /></HStack> : null}
        {busy && activity && !['download', 'generate'].includes(activity.kind) ? <HStack className="activity" role="status" gap={3} vAlign="center"><VStack className="grow" gap={2}><HStack hAlign="between"><ActivityLabel activity={activity} />{activity.total > 0 ? <small>{formatSize(activity.received)} / {formatSize(activity.total)}</small> : null}</HStack><progress value={activity.total > 0 ? activity.received : undefined} max={activity.total || 1} /></VStack><Button label={activity.kind === 'download' ? t('@yovoice.action.pause') : t('@yovoice.action.cancel')} size="sm" onClick={() => run(() => call('operation.cancel'))} /></HStack> : null}
    </VStack>
    {ready && !draft.subtitles && !isKokoroModel(draft.modelId) && !isVoxModel(draft.modelId) && !isReferenceModel(draft.modelId) && page === 'create' && !voicePicker && !pronunciation && !deleteTarget ? <SelectionAction key={draft.id} editor={editor} onEdit={annotate} /> : null}

    {voiceTarget ? <VoiceTarget voice={voiceTarget} drafts={projectList} apply={applyToTarget} close={() => setVoiceTarget(null)} /> : null}
    {deleteTarget ? <ConfirmDelete title={t('@yovoice.app.deleteProjectTitle')} description={t('@yovoice.app.deleteProjectBody', { title: deleteTarget.title })}
      confirmLabel={t('@yovoice.app.deleteProjectConfirm')} busy={deleting} error={deleteError.startsWith('@yovoice.') ? t(deleteError) : deleteError} onClose={() => setDeleteTarget(null)} onConfirm={() => void deleteDraft()} /> : null}
    {voiceEditor ? <VoiceEditor item={voiceEditor} close={() => setVoiceEditor(null)} /> : null}
    {voicePicker ? <Suspense fallback={<p role="status">{t('@yovoice.app.loadingVoicePicker')}</p>}><VoicePicker adding={voicePicker === 'add'} voices={state.voices} onClose={() => setVoicePicker(null)} onSelect={voice => { if ((activeSpeaker || draft.performance) && voicePicker !== 'add') { changeSpeaker(voicePicker === 'emotion' ? { emotionVoiceId: voice.id } : { voiceId: voice.id, referenceText: voice.referenceText ?? '' }); setVoicePicker(null); } else selectVoice(voice); }} /></Suspense> : null}
    {pronunciation ? <AppDialog title={t('@yovoice.app.pronunciationTitle')} width={480} onClose={() => setPronunciation(null)} actions={<><Button label={t('@yovoice.action.cancel')} onClick={() => setPronunciation(null)} /><Button label={t('@yovoice.app.pronunciationApply')} variant="primary" isDisabled={!pronunciation.sound.trim()} onClick={() => { const { start, end, word, sound } = pronunciation; const replacement = draft.modelId.startsWith('index-2.5') ? `<${word}|${sound.trim()}>` : sound.trim(); change({ text: draft.text.slice(0, start) + replacement + draft.text.slice(end) }); setPronunciation(null); requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + replacement.length, start + replacement.length); }); }} /></>}><p>{t('@yovoice.app.pronunciationBody', { word: pronunciation.word })}</p><TextInput label={draft.modelId.startsWith('index-2.5') ? t('@yovoice.app.pronunciationLabel25') : t('@yovoice.app.pronunciationLabel')} value={pronunciation.sound} onChange={sound => setPronunciation({ ...pronunciation, sound })} placeholder={t('@yovoice.app.pronunciationPlaceholder')} /></AppDialog> : null}
  </VStack>;
}
