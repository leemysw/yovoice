import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Pencil, Play, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack, Layout, LayoutHeader, LayoutFooter } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Inspector } from '../create/Inspector';
import { Player } from '../media/Player';
const VoicePicker = lazy(() => import('../media/VoicePicker').then(module => ({ default: module.VoicePicker })));
import { call } from '../../shared/lib/client';
import { formatActivity, formatActivityError, formatCallError } from '../../shared/i18n/format';
import { previewStale, synthesisSettings, type Character, type Draft, type State, type ModelPackage, type Track } from '../../shared/workbench';

export function CharacterEditor({ initial, state, catalog, script, active = true, close }: { active?: boolean; initial: Character; state: State; catalog: ModelPackage[]; script: string; close: (saved?: boolean) => void }) {
  const t = useTranslator();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [character, setCharacter] = useState(() => structuredClone(initial));
  const [showInspector, setShowInspector] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [choosing, setChoosing] = useState<'voice' | 'emotion' | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [temporary, setTemporary] = useState<string[]>([]);
  const busy = state.activity?.status === 'running';
  const editingBusy = saving || requesting || !!pending || (busy && temporary.length > 0);
  const draft: Draft = { ...character.settings, id: character.id, title: character.name, text: character.demoText };
  const change = (patch: Partial<Draft>) => setCharacter(c => ({ ...c, settings: synthesisSettings({ ...c.settings, id: c.id, title: c.name, text: c.demoText, ...patch }) }));
  useEffect(() => {
    if (!pending) return;
    const result = state.previews?.find(p => p.id === pending);
    if (result) { setCharacter(c => ({ ...c, preview: result })); setTrack(null); setPending(null); }
    else if (state.activity?.requestId === pending && ['failed', 'cancelled', 'interrupted'].includes(state.activity.status)) {
      setError(formatActivityError(t, state.activity) ?? formatActivity(t, state.activity)); setPending(null);
    }
  }, [pending, state.previews, state.activity, t]);
  async function cleanup() { for (const id of temporary) await call('character.discardPreview', { id }); }
  async function finish() {
    setSaving(true);
    try { await cleanup(); close(); } catch (e) { setError(formatCallError(t, e)); } finally { setSaving(false); }
  }
  async function save(copy = false) {
    setSaving(true); setError('');
    try {
      await call('character.save', { ...character, id: copy ? crypto.randomUUID().replaceAll('-', '') : character.id });
      await cleanup(); close(true);
    } catch (e) { setError(formatCallError(t, e)); } finally { setSaving(false); }
  }
  async function generate() {
    setRequesting(true); setError('');
    try { const id = await call<string>('character.preview', character); setTemporary(ids => [...ids, id]); setPending(id); }
    catch (e) { setError(formatCallError(t, e)); } finally { setRequesting(false); }
  }
  const invalid = !character.name.trim() ? '@yovoice.library.nameRequired' : character.name.length > 120 ? '@yovoice.character.nameLimit' : character.demoText.length > 2000 ? '@yovoice.library.textLimit' : '';
  const existing = state.characters?.some(c => c.id === initial.id);
  const preview = character.preview;
  const demoTrack: Track | null = preview ? { id: preview.id, fileName: preview.fileName, name: character.name, kind: 'outputs', subtitle: '' } : null;
  const saveAction = <Button label={t('@yovoice.character.save')} variant="primary" width="100%" size="lg" isLoading={saving} isDisabled={editingBusy || !!invalid} onClick={() => void save()} />;
  const previewAction = <VStack gap={3}>
    {saveAction}
    {existing ? <Button label={t('@yovoice.character.copy')} width="100%" isDisabled={editingBusy || !!invalid} onClick={() => void save(true)} /> : null}
    {pending && busy ? <Button label={t('@yovoice.create.cancelGenerate')} width="100%" onClick={() => { void call('operation.cancel').catch(e => setError(formatCallError(t, e))); }} /> : <Button label={t(preview ? '@yovoice.character.regenerate' : '@yovoice.character.preview')} width="100%" size="lg" isLoading={requesting || !!pending} isDisabled={editingBusy || busy || !!invalid || !character.demoText.trim()} onClick={() => void generate()} />}
    {pending && state.activity ? <small role="status">{formatActivity(t, state.activity)}</small> : null}
  </VStack>;
  return <>
    <VStack data-testid="character-editor" className="character-editor" data-character-active={active} gap={0} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        if (!choosing && !editingBusy && !busy && !invalid && character.demoText.trim()) void generate();
      }
    }}><Layout height="fill" padding={0} header={<LayoutHeader><HStack gap={3} padding={4} vAlign="center" hAlign="between" wrap="wrap">
      <h2 tabIndex={-1} ref={heading}>{t(existing ? '@yovoice.character.edit' : '@yovoice.character.saveAs')}</h2>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {!showInspector ? <HStack className="inspector-toggle" gap={0}>{saveAction}</HStack> : null}
        <Button label={t('@yovoice.character.close')} isIconOnly variant="ghost" icon={<X size={18} />} isDisabled={editingBusy} onClick={() => void finish()} />
      </HStack>
    </HStack></LayoutHeader>} content={<HStack className={`studio ${showInspector ? 'show-inspector' : ''}`} gap={0}>
      <VStack as="section" className="document" gap={0}>
        <VStack className="writing" gap={0}>
          <HStack className="document-heading" gap={3} vAlign="center">
            <input className="document-title" aria-label={t('@yovoice.character.name')} placeholder={t('@yovoice.character.name')} value={character.name} onChange={event => setCharacter(c => ({ ...c, name: event.target.value }))} />
            <Button label={t('@yovoice.app.voiceSettings')} className="inspector-toggle" isIconOnly icon={<SlidersHorizontal size={17} />} variant="ghost" onClick={() => setShowInspector(true)} />
          </HStack>
          <HStack gap={3} paddingBlockStart={4} hAlign="between" vAlign="center"><small>{t('@yovoice.character.demo')}</small><Button size="sm" variant="ghost" label={t('@yovoice.character.useText')} isDisabled={!script || script.length > 2000} onClick={() => setCharacter(c => ({ ...c, demoText: script }))} /></HStack>
          <textarea className="script-editor" aria-label={t('@yovoice.character.demo')} placeholder={t('@yovoice.character.example')} value={character.demoText} spellCheck={false} onChange={event => setCharacter(c => ({ ...c, demoText: event.target.value }))} />
          <HStack className="editor-status" hAlign="end"><small>{character.demoText.length} / 2000</small></HStack>
        </VStack>
      </VStack>
      <Inspector draft={draft} state={state} catalog={catalog} change={change} chooseVoice={() => setChoosing('voice')} chooseEmotion={() => setChoosing('emotion')} play={value => setTrack({ ...value, playRequest: performance.now() })} generate={() => void generate()} cancel={() => {}} settings={() => {}} advanced={advanced} setAdvanced={setAdvanced} close={() => setShowInspector(false)} allowModelManagement={false} generationAction={previewAction} libraryActions={<>
        {!state.models.some(m => m.id === character.settings.modelId) ? <p className="helper">{t('@yovoice.character.missingModel')}</p> : null}
        {[character.settings.voiceId, character.settings.emotionVoiceId].some(id => id && !state.voices.some(v => v.id === id)) ? <p role="alert">{t('@yovoice.character.missingVoice')}</p> : null}
        {character.settings.voiceId || character.settings.emotionVoiceId ? <Button size="sm" variant="ghost" label={t('@yovoice.character.clearReferences')} onClick={() => change({ voiceId: null, emotionVoiceId: null, referenceText: '' })} /> : null}
      </>} />
    </HStack>} footer={<LayoutFooter><VStack gap={0}>
      <HStack gap={3} paddingInline={4} paddingBlock={2} hAlign="between" vAlign="center" wrap="wrap">
        <small role="status">{t(previewStale(character) ? '@yovoice.character.stale' : preview ? '@yovoice.character.ready' : '@yovoice.character.emptyPreview')}</small>
        {demoTrack && track ? <Button size="sm" variant="ghost" label={t('@yovoice.character.listen')} onClick={() => setTrack(null)} /> : null}
        {invalid ? <small role="alert" className="dialog-error">{t(invalid)}</small> : null}
        {error ? <small role="alert">{error.startsWith('@yovoice.') ? t(error) : error}</small> : null}
      </HStack>
      <Player track={track ?? demoTrack} suspended={!active || !!choosing} onError={setError} />
    </VStack></LayoutFooter>} /></VStack>
    {choosing ? <Suspense fallback={<p role="status">{t('@yovoice.app.loadingVoicePicker')}</p>}><VoicePicker voices={state.voices} onClose={() => setChoosing(null)} onSelect={voice => { change(choosing === 'voice' ? { voiceId: voice.id, referenceText: voice.referenceText ?? '' } : { emotionVoiceId: voice.id }); setChoosing(null); }} /></Suspense> : null}
  </>;
}

export function CharacterLibrary({ state, catalog, create, edit, apply, onError }: { state: State; catalog: ModelPackage[]; create: () => void; edit: (c: Character) => void; apply: (c: Character) => void; onError: (message: string) => void }) {
  const t = useTranslator();
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Character | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const characters = state.characters ?? [];
  const filtered = characters.filter(c => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <VStack className="library-page voices-page" gap={5}>
    <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap"><h1>{t('@yovoice.nav.characters')}</h1><Button label={t('@yovoice.character.saveAs')} icon={<Plus size={16} />} onClick={create} /></HStack>
    {characters.length ? <TextInput label={t('@yovoice.character.search')} isLabelHidden placeholder={t('@yovoice.character.search')} startIcon={<Search size={16} />} hasClear value={query} onChange={setQuery} /> : null}
    <VStack className={characters.length ? "voice-library-list" : "empty-state"} gap={0} vAlign={characters.length ? undefined : "center"} hAlign={characters.length ? undefined : "center"}>
    {!characters.length ? <p>{t('@yovoice.character.empty')}</p> : !filtered.length ? <p role="status">{t('@yovoice.character.noResults')}</p> : filtered.map(c => <VStack key={c.id} className="voice-library-item" gap={0}>
      <HStack className="voice-library-row" gap={3} wrap="wrap" vAlign="center">
        <Button label={t('@yovoice.character.listen')} size="sm" variant="ghost" isIconOnly icon={playing === c.id ? <X size={16} /> : <Play size={16} />} isDisabled={!c.preview} onClick={() => setPlaying(playing === c.id ? null : c.id)} />
        <VStack gap={1} className="grow"><h3 title={c.name}>{c.name}</h3><p className="helper">{catalog.find(m => m.id === c.settings.modelId)?.name ?? c.settings.modelId} · {state.voices.find(v => v.id === c.settings.voiceId)?.name ?? t(c.settings.voiceId ? '@yovoice.character.missingVoice' : '@yovoice.character.sourceDesign')}</p><p>{t(previewStale(c) ? '@yovoice.character.stale' : c.preview ? '@yovoice.character.ready' : '@yovoice.character.emptyPreview')}</p></VStack>
        <Button size="sm" label={t('@yovoice.character.apply')} onClick={() => apply(c)} />
        <Button size="sm" variant="ghost" isIconOnly icon={<Pencil size={16} />} label={t('@yovoice.character.edit')} onClick={() => { setPlaying(null); edit(c); }} />
        <Button size="sm" variant="ghost" isIconOnly icon={<Trash2 size={16} />} label={t('@yovoice.character.delete')} onClick={() => { setError(''); setDeleting(c); }} />
      </HStack>
      {playing === c.id && c.preview ? <Player compact suspended={!!deleting} track={{ id: c.preview.id, name: c.name, fileName: c.preview.fileName, kind: 'outputs', subtitle: '' }} onError={onError} /> : null}
    </VStack>)}
    </VStack>
    {deleting ? <Dialog isOpen padding={6} onOpenChange={open => { if (!open && !saving) setDeleting(null); }}><VStack gap={4}><h2 tabIndex={-1} data-autofocus="">{t('@yovoice.character.delete')}</h2><p>{deleting.name} — {t('@yovoice.character.deleteConfirm')}</p>{error ? <p role="alert">{error.startsWith('@yovoice.') ? t(error) : error}</p> : null}<HStack className="dialog-actions" gap={2} hAlign="end"><Button label={t('@yovoice.action.cancel')} isDisabled={saving} onClick={() => setDeleting(null)} /><Button label={t('@yovoice.character.delete')} variant="destructive" isLoading={saving} onClick={() => { setSaving(true); void call('character.delete', { id: deleting.id }).then(() => { setDeleting(null); setPlaying(null); }).catch(e => setError(formatCallError(t, e))).finally(() => setSaving(false)); }} /></HStack></VStack></Dialog> : null}
  </VStack>;
}
