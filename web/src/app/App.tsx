import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useResizable, ResizeHandle } from '@astryxdesign/core/Resizable';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack, Layout } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Dialog } from '@astryxdesign/core/Dialog';
import { AudioLines, PanelLeft, Plus, Pencil, Clock3, Settings2, Check, Play, X, Trash2, Mic, SlidersHorizontal } from 'lucide-react';
import { call, subscribe, isDesktop, isMac } from '../shared/lib/client';
import { createDraft, emptyState, formatTime, formatSize, type Draft, type State, type ModelPackage, type Voice, type Generation, type Track } from '../shared/workbench';
import { MediaActions } from '../features/media/MediaActions';
import { Inspector } from '../features/create/Inspector';
const Settings = lazy(() => import('../features/settings/Settings').then(module => ({ default: module.Settings })));
import { Player } from '../features/media/Player';
const VoicePicker = lazy(() => import('../features/media/VoicePicker').then(module => ({ default: module.VoicePicker })));
import { SelectionAction, type TextSelection } from '../features/create/SelectionAction';
const destinations = [{ id: 'create', name: '创作', icon: Pencil }, { id: 'voices', name: '声音库', icon: AudioLines }, { id: 'history', name: '历史记录', icon: Clock3 }, { id: 'settings', name: '设置', icon: Settings2 }];
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
  const run = useCallback((action: () => Promise<unknown>) => { void action().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    const unsubscribe = subscribe(setState);
    void call<{ state: State; catalog: ModelPackage[] }>('state.get').then(result => {
      setState(result.state); setCatalog(result.catalog); setDraft(result.state.drafts[0] ?? createDraft(true));
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
    const latest = state.history.find(item => item.settings.id === draft.id);
    const key = `${draft.id}/${latest?.id ?? ''}`;
    if (key !== previousHistory.current) setTrack(latest ? { id: latest.id, name: latest.title, fileName: latest.fileName, kind: 'outputs', subtitle: '生成结果' } : null);
    previousHistory.current = key;
  }, [draft.id, state.history, ready]);
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
  function selectGeneration(item: Generation) {
    clearTimeout(saveTimer.current);
    setDraft(current => ({ ...structuredClone(item.settings), id: current.id, title: current.title }));
    setTrack({ id: item.id, name: item.title, fileName: item.fileName, kind: 'outputs', subtitle: '生成结果' });
  }
  useEffect(() => { setPreviewTrack(null); setTrack(current => current ? { ...current, playRequest: undefined } : null); }, [page]);
  const audition = (value: Track) => {
    if (page === 'create') setTrack({ ...value, playRequest: performance.now() });
    else setPreviewTrack(current => current?.id === value.id ? null : { ...value, playRequest: performance.now() });
  };
  const change = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const generate = () => {
    if (state.activity?.status === 'running') return;
    if (!state.voices.some(voice => voice.id === draft.voiceId)) { setVoicePicker('voice'); return; }
    if (!state.runtimePath || state.runtimeBackend !== state.preferences.backend || !state.models.some(m => m.id === draft.modelId)) {
      setPage('settings'); setError('开始生成前，请准备模型与推理运行时。'); return;
    }
    run(() => call('generation.start', draft));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && page === 'create' && !document.querySelector('[role=dialog]')) { event.preventDefault(); generate(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  function newDraft() { run(async () => { await call('draft.save', draft); const next = createDraft(); await call('draft.save', next); setDraft(next); setPage('create'); }); }
  function selectDraft(item: Draft) { run(async () => { await call('draft.save', draft); setDraft(item); setPage('create'); }); }
  async function deleteDraft() {
    if (!deleteTarget || deleting) return;
    setDeleting(true); clearTimeout(saveTimer.current); ++saveSequence.current;
    try {
      // 等待已发出的保存，再切换当前作品，避免删除后被延迟保存恢复。
      await pendingSave.current.catch(() => {});
      if (deleteTarget.id === draft.id) {
        const next = state.drafts.find(item => item.id !== draft.id) ?? createDraft();
        window.__workbenchDraft = next; setDraft(next);
        await call('draft.save', next);
      }
      await call('draft.delete', { id: deleteTarget.id });
      setDeleteTarget(null);
    } catch (error) { setError((error as Error).message); setDeleteTarget(null); }
    finally { setDeleting(false); }
  }
  function selectVoice(voice: Voice) { if (voicePicker !== 'add') change(voicePicker === 'emotion' ? { emotionVoiceId: voice.id } : { voiceId: voice.id }); setVoicePicker(null); }
  function annotate(selection: TextSelection) {
    setPronunciation({ ...selection, sound: '' });
  }
  const generations = state.history.filter(item => item.settings.id === draft.id);
  const activity = state.activity; const busy = activity?.status === 'running';
  const sidebar = <VStack as="nav" className="sidebar" aria-label="主导航" gap={6}>
    <Button label="新建作品" icon={<Plus size={18} />} className="new-project" width="100%" onClick={newDraft} />
    <VStack gap={2}>{destinations.slice(0, 3).map(({ id, name, icon: Icon }) => <Button key={id} label={name} variant="ghost" icon={<Icon size={18} />} className={`nav-item ${page === id ? 'selected' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)} />)}</VStack>
    <VStack className="recent-projects" gap={2}><small>最近作品</small><VStack className="project-list" gap={1}>{state.drafts.map(item => <HStack key={item.id} className={`project-row ${item.id === draft.id && page === 'create' ? 'current' : ''}`} gap={0} vAlign="center"><Button label={item.id === draft.id ? draft.title : item.title} variant="ghost" size="sm" className="project-link grow" aria-current={item.id === draft.id && page === 'create' ? 'page' : undefined} onClick={() => selectDraft(item)} /><Button label={`删除作品：${item.id === draft.id ? draft.title : item.title}`} className="project-delete" size="sm" variant="ghost" isIconOnly icon={<Trash2 size={14} />} onClick={() => setDeleteTarget(item.id === draft.id ? draft : item)} /></HStack>)}</VStack></VStack>
    <VStack className="sidebar-bottom" gap={3}><Button label="设置" icon={<Settings2 size={18} />} variant="ghost" className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')} /></VStack>
    <ResizeHandle label="调整侧栏宽度" direction="horizontal" resizable={navigation.props} isAlwaysVisible={false} hasDivider />
  </VStack>;
  const inspector = <Inspector catalog={catalog} close={() => setShowInspector(false)} draft={draft} state={state} change={change} chooseVoice={() => setVoicePicker('voice')} chooseEmotion={() => setVoicePicker('emotion')} play={audition} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => setPage('settings')} advanced={advanced} setAdvanced={setAdvanced} />;
  return <VStack className={`workbench ${isDesktop ? 'desktop' : 'preview'}`} style={{ '--app-nav': `${navigation.size}px` } as CSSProperties} gap={0}>
    {!isMac ? <HStack as="header" className="browser-titlebar" gap={2} vAlign="center"><Button label={navigation.isCollapsed ? '展开侧栏' : '收起侧栏'} isIconOnly variant="ghost" size="sm" icon={<PanelLeft size={17} />} aria-expanded={!navigation.isCollapsed} onClick={toggleSidebar} /><b>yovoice</b>{!isDesktop ? <small>桌面界面预览</small> : null}</HStack> : null}
    <AppShell variant="surface" sideNav={navigation.isCollapsed ? undefined : sidebar} mobileNav={{ breakpoint: 'none' }} height="fill">
      <Layout height="fill" footer={page === 'create' ? <Player suspended={voicePicker !== null} track={track} onError={onError} historyControl={generations.length ? <Selector label="当前作品历史" isLabelHidden placement="above" size="sm" variant="ghost" width="100%" isDisabled={busy} value={track?.kind === 'outputs' ? track.id : undefined} placeholder="历史版本" options={generations.map((item, index) => ({ value: item.id, label: `版本 ${generations.length - index}`, description: new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }))} renderValue={option => option.label} onChange={id => { const item = generations.find(item => item.id === id); if (item) selectGeneration(item); }} /> : undefined} /> : undefined} content={<VStack className="content-frame" gap={0}>
        {error || activity?.status === 'failed' ? <HStack className="notice" role="alert" gap={3} hAlign="between" vAlign="center"><p>{error || activity?.error}</p><Button label="关闭提示" variant="ghost" isIconOnly icon={<X size={16} />} onClick={() => { setError(''); if (activity?.status === 'failed') setState(s => ({ ...s, activity: null })); }} /></HStack> : null}
        {busy && !['download', 'generate'].includes(activity.kind) ? <HStack className="activity" role="status" gap={3} vAlign="center"><VStack className="grow" gap={2}><HStack hAlign="between"><strong>{activity.label}</strong>{activity.total > 0 ? <small>{formatSize(activity.received)} / {formatSize(activity.total)}</small> : null}</HStack><progress value={activity.total > 0 ? activity.received : undefined} max={activity.total || 1} /></VStack><Button label={activity.kind === 'download' ? '暂停' : '取消'} size="sm" onClick={() => run(() => call('operation.cancel'))} /></HStack> : null}
        {!ready ? <p className="loading" role="status">正在打开工作台…</p> : page === 'create' ? <HStack className={`studio ${showInspector ? 'show-inspector' : ''}`} gap={0}>
          <VStack as="section" className="document" gap={0}>

            <VStack className="writing" gap={0}>
              <HStack className="document-heading" gap={3} vAlign="center"><input className="document-title" aria-label="作品名称" maxLength={120} value={draft.title} onChange={e => change({ title: e.target.value })} /><Button label="声音设置" className="inspector-toggle" isIconOnly icon={<SlidersHorizontal size={17} />} variant="ghost" onClick={() => setShowInspector(!showInspector)} /></HStack>
              <textarea ref={editor} className="script-editor" aria-label="正文" placeholder="从第一句话开始…" maxLength={12000} value={draft.text} spellCheck={false} dir={draft.language === 'ar' ? 'rtl' : 'auto'} onChange={e => change({ text: e.target.value })} />
              <HStack className="editor-status" hAlign="end" vAlign="center" gap={4}><small className="saved"><Check size={14} />{saving ? '保存中…' : '已保存'}</small><small>{Array.from(draft.text).length} 字</small></HStack>

            </VStack>
          </VStack>{inspector}
        </HStack> : page === 'settings' ? <Suspense fallback={<p role="status">正在加载设置…</p>}><Settings state={state} catalog={catalog} draft={draft} run={run} onModel={id => { change({ modelId: id, language: id.startsWith('index-2.5') ? draft.language : ['zh', 'en'].includes(draft.language) ? draft.language : 'zh' }); setPage('create'); }} /></Suspense> : <VStack className={`library-page ${page === 'voices' ? 'voices-page' : 'history-page'}`} gap={6}>
          <HStack hAlign="between" vAlign="center" wrap="wrap" gap={3}><header><h1>{page === 'voices' ? '声音库' : '历史记录'}</h1><p className="subtitle">{page === 'voices' ? `${state.voices.length} 个音色` : `${state.history.length} 条生成记录`}</p></header>{page === 'voices' && state.voices.length > 0 ? <Button label="添加声音" size="sm" icon={<Plus size={16} />} onClick={() => setVoicePicker('add')} /> : null}</HStack>
          {page === 'voices' ? state.voices.length ? <VStack gap={0} className="voice-library-list">{state.voices.map(voice => <VStack key={voice.id} className="voice-library-item" gap={0}>
            <HStack className="voice-library-row" gap={3} vAlign="center"><AudioLines className="voice-mark" size={20} /><h3 className="grow" title={voice.name}>{voice.name}</h3><small className="time">{formatTime(voice.duration)}</small><Button label={previewTrack?.id === voice.id ? `收起试听${voice.name}` : `试听${voice.name}`} size="sm" variant="ghost" isIconOnly icon={previewTrack?.id === voice.id ? <X size={16} /> : <Play size={16} />} onClick={() => audition({ ...voice, kind: 'voices', subtitle: '参考音频' })} /><MediaActions item={{ ...voice, kind: 'voices' }} beforeDelete={() => setPreviewTrack(null)} onError={onError} /></HStack>
            {previewTrack?.id === voice.id ? <Player compact suspended={voicePicker !== null} track={previewTrack} onError={onError} /> : null}
          </VStack>)}</VStack> : <VStack className="empty-state" gap={4} align="center"><Mic size={40} strokeWidth={1} /><h2>从一个声音开始</h2><p>导入清晰的人声，或录下你自己的声音。</p><Button label="添加第一个声音" variant="primary" onClick={() => setVoicePicker('add')} /></VStack> : state.history.length ? <VStack className="history-list" gap={0}>{state.history.map(item => <VStack key={item.id} className="history-item" gap={0}><HStack className="history-row" gap={3} vAlign="center"><Button label={previewTrack?.id === item.id ? `收起试听${item.title}` : `试听${item.title}`} size="sm" variant="ghost" isIconOnly icon={previewTrack?.id === item.id ? <X size={16} /> : <Play size={16} />} onClick={() => audition({ id: item.id, name: item.title, fileName: item.fileName, kind: 'outputs', subtitle: '生成结果' })} /><HStack gap={4} vAlign="center" className="grow history-info"><h3 title={item.title}>{item.title}</h3><small>{new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></HStack><small className="time">{formatTime(item.duration)}</small><HStack className="history-actions" gap={1}><Button label="复用参数" size="sm" variant="ghost" onClick={() => { setDraft({ ...item.settings, id: crypto.randomUUID().replaceAll('-', ''), title: item.title + ' · 副本' }); setPage('create'); }} /><MediaActions item={{ id: item.id, kind: 'outputs', name: item.title }} beforeDelete={() => setPreviewTrack(null)} onError={onError} /></HStack></HStack>{previewTrack?.id === item.id ? <Player compact suspended={false} track={previewTrack} onError={onError} /> : null}</VStack>)}</VStack> : <VStack className="empty-state" gap={4} align="center"><Clock3 size={40} strokeWidth={1} /><h2>让第一句话被听见</h2><p>生成的音频和参数会自动保存在这里。</p><Button label="开始创作" onClick={() => setPage('create')} /></VStack>}
        </VStack>}
      </VStack>} />
    </AppShell>
    {ready && page === 'create' && !voicePicker && !pronunciation && !deleteTarget ? <SelectionAction key={draft.id} editor={editor} onEdit={annotate} /> : null}

    {deleteTarget ? <Dialog isOpen onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }} width={400} padding={6}><VStack gap={4}><h2>删除作品？</h2><p className="helper">“{deleteTarget.title}”的草稿将被删除，已生成的音频仍保留在历史记录中。</p><HStack hAlign="end" gap={2}><Button label="取消" size="sm" isDisabled={deleting} onClick={() => setDeleteTarget(null)} /><Button label="删除作品" size="sm" variant="primary" isLoading={deleting} onClick={() => void deleteDraft()} /></HStack></VStack></Dialog> : null}
    {voicePicker ? <Suspense fallback={<p role="status">正在加载声音选择…</p>}><VoicePicker adding={voicePicker === 'add'} voices={state.voices} onClose={() => setVoicePicker(null)} onSelect={selectVoice} /></Suspense> : null}
    {pronunciation ? <Dialog isOpen onOpenChange={open => { if (!open) setPronunciation(null); }} width={480} purpose="form" padding={6}><VStack gap={5}><h2>调整发音</h2><p>为“{pronunciation.word}”指定读法。</p><TextInput label={draft.modelId.startsWith('index-2.5') ? '拼音 / 英文音素 / 日语假名' : '拼音'} value={pronunciation.sound} onChange={sound => setPronunciation({ ...pronunciation, sound })} placeholder="例如 HANG2" /><HStack hAlign="end" gap={3}><Button label="取消" onClick={() => setPronunciation(null)} /><Button label="应用发音" variant="primary" isDisabled={!pronunciation.sound.trim()} onClick={() => { const { start, end, word, sound } = pronunciation; const replacement = draft.modelId.startsWith('index-2.5') ? `<${word}|${sound.trim()}>` : sound.trim(); change({ text: draft.text.slice(0, start) + replacement + draft.text.slice(end) }); setPronunciation(null); requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + replacement.length, start + replacement.length); }); }} /></HStack></VStack></Dialog> : null}
  </VStack>;
}
