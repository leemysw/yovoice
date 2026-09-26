import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useResizable, ResizeHandle } from '@astryxdesign/core/Resizable';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack, Layout } from '@astryxdesign/core/Layout';
import { Selector } from '../shared/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Dialog } from '@astryxdesign/core/Dialog';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { AudioLines, PanelLeft, Plus, Pencil, Clock3, Settings2, Check, Play, X, Trash2, Mic, SlidersHorizontal } from 'lucide-react';
import { call, subscribe, isDesktop } from '../shared/lib/client';
import { isKokoroModel, isReferenceModel, isVoxModel, requiresVoice, createDraft, emptyState, formatTime, formatSize, type Activity, type Draft, type State, type ModelPackage, type Voice, type Generation, type Track } from '../shared/workbench';
import { CharacterEditor, CharacterLibrary } from '../features/library/Characters';
import { VoiceEditor } from '../features/library/VoiceEditor';
import { synthesisSettings, type Character } from '../shared/workbench';
import { MediaActions } from '../features/media/MediaActions';
import { Inspector } from '../features/create/Inspector';
const Settings = lazy(() => import('../features/settings/Settings').then(module => ({ default: module.Settings })));
import { Player } from '../features/media/Player';
const VoicePicker = lazy(() => import('../features/media/VoicePicker').then(module => ({ default: module.VoicePicker })));
import { SelectionAction, type TextSelection } from '../features/create/SelectionAction';
import { LocaleShell, ensureUiLocalePersisted, bootLocale } from './LocaleShell';
import { isUiLocale } from '../shared/i18n/locale';
import { formatActivity, formatActivityError } from '../shared/i18n/format';

const destinationIds = [
  { id: 'create', key: '@yovoice.nav.create', icon: Pencil },
  { id: 'characters', key: '@yovoice.nav.characters', icon: AudioLines },
  { id: 'voices', key: '@yovoice.nav.voices', icon: AudioLines },
  { id: 'history', key: '@yovoice.nav.history', icon: Clock3 },
  { id: 'settings', key: '@yovoice.nav.settings', icon: Settings2 },
] as const;

function NoticeText({ error, activity }: { error: string; activity: Activity | null | undefined }) {
  const t = useTranslator();
  if (error.startsWith('@yovoice.')) return <>{t(error)}</>;
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
  newDraft: () => void;
  state: State;
  draft: Draft;
  selectDraft: (item: Draft) => void;
  setDeleteTarget: (item: Draft) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: { props: any };
}) {
  const t = useTranslator();
  const { page, setPage, newDraft, state, draft, selectDraft, setDeleteTarget, navigation } = props;
  return <VStack as="nav" className="sidebar" aria-label={t('@yovoice.nav.main')} gap={6} data-testid="sidebar">
    <Button data-testid="nav-new" label={t('@yovoice.nav.newProject')} icon={<Plus size={18} />} className="new-project" width="100%" onClick={newDraft} />
    <VStack gap={2}>{destinationIds.slice(0, -1).map(({ id, key, icon: Icon }) => <Button key={id} data-testid={`nav-${id}`} label={t(key)} variant="ghost" icon={<Icon size={18} />} className={`nav-item ${page === id ? 'selected' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)} />)}</VStack>
    <VStack className="recent-projects" gap={2}><small>{t('@yovoice.nav.recent')}</small><VStack className="project-list" gap={1}>{state.drafts.map(item => <HStack key={item.id} className={`project-row ${item.id === draft.id && page === 'create' ? 'current' : ''}`} gap={0} vAlign="center"><Button label={item.id === draft.id ? draft.title : item.title} variant="ghost" size="sm" className="project-link grow" aria-current={item.id === draft.id && page === 'create' ? 'page' : undefined} onClick={() => selectDraft(item)} /><Button label={t('@yovoice.nav.deleteProject', { title: item.id === draft.id ? draft.title : item.title })} className="project-delete" size="sm" variant="ghost" isIconOnly icon={<Trash2 size={14} />} onClick={() => setDeleteTarget(item.id === draft.id ? draft : item)} /></HStack>)}</VStack></VStack>
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
  const [draft, setDraft] = useState<Draft>(() => createDraft(true)); const [ready, setReady] = useState(false);
  const [page, setPage] = useState('create'); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [voicePicker, setVoicePicker] = useState<'voice' | 'emotion' | 'add' | null>(null);
  const [previewTrack, setPreviewTrack] = useState<Track | null>(null);
  const [track, setTrack] = useState<Track | null>(null); const [advanced, setAdvanced] = useState(false);
  const [pronunciation, setPronunciation] = useState<{ start: number; end: number; word: string; sound: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
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
  const run = useCallback((action: () => Promise<unknown>) => { void action().catch(e => setError(e instanceof Error && e.name === 'CallError' ? e.message : (e as Error).message)); }, []);
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
      setState(next); setCatalog(result.catalog); setDraft(next.drafts[0] ?? createDraft(true, next.preferences.uiLocale));
      setReady(true);
    }).catch(e => setError(e.message));
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!ready || deleting) return;
    window.__workbenchDraft = draft;
    setSaving(true); const sequence = ++saveSequence.current;
    const timer = saveTimer.current = setTimeout(() => {
      pendingSave.current = pendingSave.current.catch(() => {}).then(() => call('draft.save', draft));
      void pendingSave.current.then(() => { if (sequence === saveSequence.current) setSaving(false); }).catch(e => { setError(e.message); });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, ready, deleting]);
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
  const change = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const generate = () => {
    if (state.activity?.status === 'running') return;
    if (requiresVoice(draft) && !state.voices.some(voice => voice.id === draft.voiceId)) { setVoicePicker('voice'); return; }
    if (!state.runtimePath || state.runtimeBackend !== state.preferences.backend || !state.models.some(m => m.id === draft.modelId)) {
      setPage('settings'); setError('@yovoice.error.needRuntime'); return;
    }
    run(() => call('generation.start', draft));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && page === 'create' && !document.querySelector('[role=dialog], [data-character-active=true]')) { event.preventDefault(); generate(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  function newDraft() { run(async () => { await call('draft.save', draft); const next = createDraft(false, state.preferences.uiLocale); await call('draft.save', next); setDraft(next); setPage('create'); }); }
  function selectDraft(item: Draft) { run(async () => { await call('draft.save', draft); setDraft(item); setPage('create'); }); }
  async function deleteDraft() {
    if (!deleteTarget || deleting) return;
    setDeleting(true); clearTimeout(saveTimer.current); ++saveSequence.current;
    try {
      // 等待已发出的保存，再切换当前作品，避免删除后被延迟保存恢复。
      await pendingSave.current.catch(() => {});
      if (deleteTarget.id === draft.id) {
        const next = state.drafts.find(item => item.id !== draft.id) ?? createDraft(false, state.preferences.uiLocale);
        window.__workbenchDraft = next; setDraft(next);
        await call('draft.save', next);
      }
      await call('draft.delete', { id: deleteTarget.id });
      setDeleteTarget(null);
    } catch (error) { setError((error as Error).message); setDeleteTarget(null); }
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
      setState={setState}
      catalog={catalog}
      draft={draft}
      setDraft={setDraft}
      ready={ready}
      page={page}
      setPage={setPage}
      error={error}
      setError={setError}
      saving={saving}
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
      saveTimer={saveTimer}
    />
  </LocaleShell>;
}

function WorkbenchChrome(props: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: { props: any; size: number; isCollapsed: boolean };
  toggleSidebar: () => void;
  state: State;
  setState: React.Dispatch<React.SetStateAction<State>>;
  catalog: ModelPackage[];
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  ready: boolean;
  page: string;
  setPage: (id: string) => void;
  error: string;
  setError: (message: string) => void;
  saving: boolean;
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
  showInspector: boolean;
  setShowInspector: (value: boolean) => void;
  editor: React.RefObject<HTMLTextAreaElement | null>;
  previousHistory: React.MutableRefObject<string | undefined>;
  onError: (message: string) => void;
  run: (action: () => Promise<unknown>) => void;
  change: (patch: Partial<Draft>) => void;
  generate: () => void;
  newDraft: () => void;
  selectDraft: (item: Draft) => void;
  deleteDraft: () => Promise<void>;
  selectVoice: (voice: Voice) => void;
  annotate: (selection: TextSelection) => void;
  generations: Generation[];
  activity: Activity | null;
  busy: boolean;
  saveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const {
    navigation, toggleSidebar, state, setState, catalog, draft, setDraft, ready, page, setPage,
    error, setError, saving, voicePicker, setVoicePicker, previewTrack, setPreviewTrack, track, setTrack,
    advanced, setAdvanced, pronunciation, setPronunciation, deleteTarget, setDeleteTarget, deleting,
    showInspector, setShowInspector, editor, previousHistory, onError, run, change, generate, newDraft,
    selectDraft, deleteDraft, selectVoice, annotate, generations, activity, busy, saveTimer,
  } = props;
  const [characterEditor, setCharacterEditor] = useState<Character | null>(null);
  const characterActive = !!characterEditor && page === 'characters';
  const characterReturnPage = useRef('create');
  const [voiceEditor, setVoiceEditor] = useState<Voice | Generation | null>(null);
  const [feedback, setFeedback] = useState('');
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  useEffect(() => setSelectedCharacter(null), [draft.id]);
  const appliedCharacter = state.characters?.find(c => c.id === selectedCharacter);
  const applyCharacter = (c: Character) => { setDraft(current => ({ ...structuredClone(c.settings), id: current.id, title: current.title, text: current.text })); setSelectedCharacter(c.id); setPage('create'); setFeedback(t('@yovoice.character.applied')); };
  const editCharacter = (character: Character) => { characterReturnPage.current = page; setCharacterEditor(character); setPage('characters'); };
  const openCharacter = (existing?: Character) => {
    editCharacter(existing ? { ...structuredClone(existing), settings: synthesisSettings(draft) } : { id: crypto.randomUUID().replaceAll('-', ''), name: draft.title, settings: synthesisSettings(draft), demoText: t('@yovoice.character.example') });
  };

  useEffect(() => {
    if (!ready) return;
    const latest = state.history.find(item => item.settings.id === draft.id);
    const key = `${draft.id}/${latest?.id ?? ''}`;
    if (key !== previousHistory.current) setTrack(latest ? { id: latest.id, name: latest.title, fileName: latest.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput') } : null);
    previousHistory.current = key;
  }, [draft.id, state.history, ready, t, previousHistory, setTrack]);

  function selectGeneration(item: Generation) {
    setSelectedCharacter(null);
    clearTimeout(saveTimer.current);
    setDraft(current => ({ ...structuredClone(item.settings), id: current.id, title: current.title }));
    setTrack({ id: item.id, name: item.title, fileName: item.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput') });
  }
  const audition = (value: Track) => {
    if (page === 'create') setTrack({ ...value, playRequest: performance.now() });
    else setPreviewTrack(current => current?.id === value.id ? null : { ...value, playRequest: performance.now() });
  };
  const dateOpts: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  const historyDateOpts: Intl.DateTimeFormatOptions = { ...dateOpts, second: '2-digit' };
  const sidebar = <SidebarNav page={page} setPage={setPage} newDraft={newDraft} state={state} draft={draft} selectDraft={selectDraft} setDeleteTarget={setDeleteTarget} navigation={navigation} />;
  const inspector = <Inspector libraryActions={<VStack gap={2}>
    {state.characters?.length ? <Selector label={t('@yovoice.character.choose')} placeholder={t('@yovoice.character.choose')} value={selectedCharacter ?? undefined} options={state.characters.map(c => ({ value: c.id, label: c.name }))} onChange={id => { const c = state.characters.find(c => c.id === id); if (c) applyCharacter(c); }} /> : null}
    <Button label={t('@yovoice.character.saveAs')} onClick={() => openCharacter()} />
    {appliedCharacter ? <Button size="sm" variant="ghost" label={t('@yovoice.character.update')} onClick={() => openCharacter(appliedCharacter)} /> : null}
  </VStack>} catalog={catalog} close={() => setShowInspector(false)} draft={draft} state={state} change={change} chooseVoice={() => setVoicePicker('voice')} chooseEmotion={() => setVoicePicker('emotion')} play={audition} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => setPage('settings')} advanced={advanced} setAdvanced={setAdvanced} />;
  return <VStack className={`workbench ${isDesktop ? 'desktop' : 'preview'}`} style={{ '--app-nav': `${navigation.size}px` } as CSSProperties} gap={0}>
    {!isDesktop ? <HStack as="header" className="browser-titlebar" gap={2} vAlign="center"><Button label={navigation.isCollapsed ? t('@yovoice.app.expandSidebar') : t('@yovoice.app.collapseSidebar')} isIconOnly variant="ghost" size="sm" icon={<PanelLeft size={17} />} aria-expanded={!navigation.isCollapsed} onClick={toggleSidebar} /><b>yovoice</b><small>{t('@yovoice.app.browserPreview')}</small></HStack> : null}
    <AppShell variant="surface" sideNav={navigation.isCollapsed ? undefined : sidebar} mobileNav={{ breakpoint: 'none' }} height="fill">
      {characterEditor ? <VStack style={{ display: page === 'characters' ? 'flex' : 'none', height: '100%', minHeight: 0 }} gap={0}><CharacterEditor active={page === 'characters'} initial={characterEditor} state={state} catalog={catalog} script={draft.text} close={saved => { setCharacterEditor(null); setPage(characterReturnPage.current); if (saved) setFeedback(t('@yovoice.character.saved')); }} /></VStack> : null}
      {!characterEditor || page !== 'characters' ? <Layout height="fill" footer={page === 'create' ? <Player suspended={voicePicker !== null || characterActive || !!voiceEditor} track={track} onError={onError} historyControl={generations.length ? <VStack gap={1}><Selector label={t('@yovoice.app.historyVersions')} isLabelHidden placement="above" size="sm" variant="ghost" width="100%" isDisabled={busy} value={track?.kind === 'outputs' ? track.id : undefined} placeholder={t('@yovoice.app.historyPlaceholder')} options={generations.map((item, index) => ({ value: item.id, label: t('@yovoice.app.historyVersion', { n: generations.length - index }), description: new Date(item.createdAt).toLocaleString(locale, dateOpts) }))} renderValue={option => option.label} onChange={id => { const item = generations.find(item => item.id === id); if (item) selectGeneration(item); }} /><Button label={t('@yovoice.voice.save')} size="sm" variant="ghost" isDisabled={track?.kind !== 'outputs' || !generations.some(g => g.id === track.id)} onClick={() => { const item = generations.find(g => g.id === track?.id); if (item) setVoiceEditor(item); }} /></VStack> : undefined} /> : undefined} content={<VStack className="content-frame" gap={0}>
        {feedback ? <HStack role="status" gap={3} padding={3} hAlign="between" vAlign="center"><HStack gap={2} vAlign="center"><Check size={16} aria-hidden="true" /><p>{feedback}</p></HStack><Button label={t('@yovoice.action.closeNotice')} variant="ghost" isIconOnly icon={<X size={16} />} onClick={() => setFeedback('')} /></HStack> : null}
        {error || activity?.status === 'failed' ? <HStack className="notice" role="alert" gap={3} hAlign="between" vAlign="center"><p><NoticeText error={error} activity={activity} /></p><Button label={t('@yovoice.action.closeNotice')} variant="ghost" isIconOnly icon={<X size={16} />} onClick={() => { setError(''); if (activity?.status === 'failed') setState(s => ({ ...s, activity: null })); }} /></HStack> : null}
        {busy && activity && !['download', 'generate'].includes(activity.kind) ? <HStack className="activity" role="status" gap={3} vAlign="center"><VStack className="grow" gap={2}><HStack hAlign="between"><ActivityLabel activity={activity} />{activity.total > 0 ? <small>{formatSize(activity.received)} / {formatSize(activity.total)}</small> : null}</HStack><progress value={activity.total > 0 ? activity.received : undefined} max={activity.total || 1} /></VStack><Button label={activity.kind === 'download' ? t('@yovoice.action.pause') : t('@yovoice.action.cancel')} size="sm" onClick={() => run(() => call('operation.cancel'))} /></HStack> : null}
        {!ready ? <p className="loading" role="status">{t('@yovoice.app.loading')}</p> : page === 'create' ? <HStack className={`studio ${showInspector ? 'show-inspector' : ''}`} gap={0}>
          <VStack as="section" className="document" gap={0}>

            <VStack className="writing" gap={0}>
              <HStack className="document-heading" gap={3} vAlign="center"><input className="document-title" aria-label={t('@yovoice.app.titleLabel')} maxLength={120} value={draft.title} onChange={e => change({ title: e.target.value })} /><Button label={t('@yovoice.app.voiceSettings')} className="inspector-toggle" isIconOnly icon={<SlidersHorizontal size={17} />} variant="ghost" onClick={() => setShowInspector(!showInspector)} /></HStack>
              <textarea ref={editor} className="script-editor" aria-label={t('@yovoice.app.scriptLabel')} placeholder={t('@yovoice.app.scriptPlaceholder')} maxLength={12000} value={draft.text} spellCheck={false} dir={draft.language === 'ar' ? 'rtl' : 'auto'} onChange={e => change({ text: e.target.value })} />
              <HStack className="editor-status" hAlign="end" vAlign="center" gap={4}><small className="saved"><Check size={14} />{saving ? t('@yovoice.app.saving') : t('@yovoice.app.saved')}</small><small>{t('@yovoice.app.charCount', { count: Array.from(draft.text).length })}</small></HStack>

            </VStack>
          </VStack>{inspector}
        </HStack> : page === 'characters' ? <CharacterLibrary create={() => openCharacter()} state={state} catalog={catalog} edit={editCharacter} apply={applyCharacter} onError={onError} /> : page === 'settings' ? <Suspense fallback={<p role="status">{t('@yovoice.app.loadingSettings')}</p>}><Settings state={state} catalog={catalog} draft={draft} run={run} /></Suspense> : <VStack className={`library-page ${page === 'voices' ? 'voices-page' : 'history-page'}`} gap={6}>
          <HStack hAlign="between" vAlign="center" wrap="wrap" gap={3}><header><h1>{page === 'voices' ? t('@yovoice.library.voicesTitle') : t('@yovoice.library.historyTitle')}</h1><p className="subtitle">{page === 'voices' ? t('@yovoice.library.voiceCount', { count: state.voices.length }) : t('@yovoice.library.historyCount', { count: state.history.length })}</p></header>{page === 'voices' && state.voices.length > 0 ? <Button label={t('@yovoice.library.addVoice')} size="sm" icon={<Plus size={16} />} onClick={() => setVoicePicker('add')} /> : null}</HStack>
          {page === 'voices' ? state.voices.length ? <VStack gap={0} className="voice-library-list">{state.voices.map(voice => <VStack key={voice.id} className="voice-library-item" gap={0}>
            <HStack className="voice-library-row" gap={3} vAlign="center">
              <Button label={previewTrack?.id === voice.id ? t('@yovoice.app.collapseAudition', { name: voice.name }) : t('@yovoice.app.audition', { name: voice.name })} size="sm" variant="ghost" isIconOnly icon={previewTrack?.id === voice.id ? <X size={16} /> : <Play size={16} />} onClick={() => audition({ ...voice, kind: 'voices', subtitle: t('@yovoice.app.subtitleReference') })} />
              <h3 className="grow" title={voice.name}>{voice.name}</h3><small className="time">{formatTime(voice.duration)}</small>
              <MediaActions onEdit={() => setVoiceEditor(voice)} item={{ ...voice, kind: 'voices' }} beforeDelete={() => setPreviewTrack(null)} onError={onError} />
            </HStack>
            {previewTrack?.id === voice.id ? <Player compact suspended={voicePicker !== null || characterActive || !!voiceEditor} track={previewTrack} onError={onError} /> : null}
          </VStack>)}</VStack> : <VStack className="empty-state" gap={4} align="center"><Mic size={40} strokeWidth={1} /><h2>{t('@yovoice.library.emptyVoicesTitle')}</h2><p>{t('@yovoice.library.emptyVoicesBody')}</p><Button label={t('@yovoice.library.addFirstVoice')} variant="primary" onClick={() => setVoicePicker('add')} /></VStack> : state.history.length ? <VStack className="history-list" gap={0}>{state.history.map(item => <VStack key={item.id} className="history-item" gap={0}><HStack className="history-row" gap={3} vAlign="center"><Button label={previewTrack?.id === item.id ? t('@yovoice.app.collapseAudition', { name: item.title }) : t('@yovoice.app.audition', { name: item.title })} size="sm" variant="ghost" isIconOnly icon={previewTrack?.id === item.id ? <X size={16} /> : <Play size={16} />} onClick={() => audition({ id: item.id, name: item.title, fileName: item.fileName, kind: 'outputs', subtitle: t('@yovoice.app.subtitleOutput') })} /><HStack gap={4} vAlign="center" className="grow history-info"><h3 title={item.title}>{item.title}</h3><small>{new Date(item.createdAt).toLocaleString(locale, historyDateOpts)}</small></HStack><small className="time">{formatTime(item.duration)}</small><HStack className="history-actions" gap={1}><Button label={t('@yovoice.voice.save')} size="sm" variant="ghost" onClick={() => setVoiceEditor(item)} /><Button label={t('@yovoice.app.reuseSettings')} size="sm" variant="ghost" onClick={() => { setDraft({ ...item.settings, id: crypto.randomUUID().replaceAll('-', ''), title: item.title + t('@yovoice.draft.copySuffix') }); setPage('create'); }} /><MediaActions item={{ id: item.id, kind: 'outputs', name: item.title }} beforeDelete={() => setPreviewTrack(null)} onError={onError} /></HStack></HStack>{previewTrack?.id === item.id ? <Player compact suspended={!!voiceEditor || characterActive} track={previewTrack} onError={onError} /> : null}</VStack>)}</VStack> : <VStack className="empty-state" gap={4} align="center"><Clock3 size={40} strokeWidth={1} /><h2>{t('@yovoice.library.emptyHistoryTitle')}</h2><p>{t('@yovoice.library.emptyHistoryBody')}</p><Button label={t('@yovoice.library.startCreating')} onClick={() => setPage('create')} /></VStack>}
        </VStack>}
      </VStack>} /> : null}
    </AppShell>
    {ready && !isKokoroModel(draft.modelId) && !isVoxModel(draft.modelId) && !isReferenceModel(draft.modelId) && page === 'create' && !voicePicker && !pronunciation && !deleteTarget ? <SelectionAction key={draft.id} editor={editor} onEdit={annotate} /> : null}

    {deleteTarget ? <Dialog isOpen onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }} width={400} padding={6}><VStack gap={4}><h2 tabIndex={-1} data-autofocus="">{t('@yovoice.app.deleteProjectTitle')}</h2><p className="helper">{t('@yovoice.app.deleteProjectBody', { title: deleteTarget.title })}</p><HStack className="dialog-actions" hAlign="end" gap={2}><Button label={t('@yovoice.action.cancel')} isDisabled={deleting} onClick={() => setDeleteTarget(null)} /><Button label={t('@yovoice.app.deleteProjectConfirm')} variant="primary" isLoading={deleting} onClick={() => void deleteDraft()} /></HStack></VStack></Dialog> : null}
    {voiceEditor ? <VoiceEditor item={voiceEditor} close={saved => { setVoiceEditor(null); if (saved) setFeedback(t('@yovoice.voice.saveSuccess')); }} /> : null}
    {voicePicker ? <Suspense fallback={<p role="status">{t('@yovoice.app.loadingVoicePicker')}</p>}><VoicePicker adding={voicePicker === 'add'} voices={state.voices} onClose={() => setVoicePicker(null)} onSelect={selectVoice} /></Suspense> : null}
    {pronunciation ? <Dialog isOpen onOpenChange={open => { if (!open) setPronunciation(null); }} width={480} purpose="form" padding={6}><VStack gap={5}><h2 tabIndex={-1} data-autofocus="">{t('@yovoice.app.pronunciationTitle')}</h2><p>{t('@yovoice.app.pronunciationBody', { word: pronunciation.word })}</p><TextInput label={draft.modelId.startsWith('index-2.5') ? t('@yovoice.app.pronunciationLabel25') : t('@yovoice.app.pronunciationLabel')} value={pronunciation.sound} onChange={sound => setPronunciation({ ...pronunciation, sound })} placeholder={t('@yovoice.app.pronunciationPlaceholder')} /><HStack className="dialog-actions" hAlign="end" gap={3}><Button label={t('@yovoice.action.cancel')} onClick={() => setPronunciation(null)} /><Button label={t('@yovoice.app.pronunciationApply')} variant="primary" isDisabled={!pronunciation.sound.trim()} onClick={() => { const { start, end, word, sound } = pronunciation; const replacement = draft.modelId.startsWith('index-2.5') ? `<${word}|${sound.trim()}>` : sound.trim(); change({ text: draft.text.slice(0, start) + replacement + draft.text.slice(end) }); setPronunciation(null); requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + replacement.length, start + replacement.length); }); }} /></HStack></VStack></Dialog> : null}
  </VStack>;
}
