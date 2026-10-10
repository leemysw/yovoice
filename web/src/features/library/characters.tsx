import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { AudioLines, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { AppDialog, ConfirmDelete } from '../../shared/ui/app-dialog';
import { LibraryEmpty, LibraryPage, Ticket, TicketStamp } from './library-layout';
import { RecordCover } from './record-cover';
import { Studio } from '../create/studio';
import { Selector } from '../../shared/selector';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack, Layout, LayoutFooter } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Inspector } from '../create/inspector';
import { Player } from '../media/player';
const VoicePicker = lazy(() => import('../media/voice-picker').then(module => ({ default: module.VoicePicker })));
import { call } from '../../shared/lib/client';
import { formatActivity, formatActivityError, formatCallError, formatNotice } from '../../shared/i18n/format';
import { stableJSON, previewStale, performanceSettings, synthesisSettings, type Character, type Draft, type State, type ModelPackage, type Track } from '../../shared/workbench';

export function CharacterEditor({ initial, state, catalog, active = true, close, settings, apply }: { active?: boolean; initial: Character; state: State; catalog: ModelPackage[]; close: (saved?: Character) => void; settings: (modelId?: string) => void; apply?: (saved: Character) => Promise<void> }) {
  const t = useTranslator();
  const [character, setCharacter] = useState(() => structuredClone(initial));
  const [performanceId, setPerformanceId] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const selectedPerformance = character.performances?.find(p => p.id === performanceId);
  const activeSettings = performanceSettings(character.settings, selectedPerformance);
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
  const draft: Draft = { ...activeSettings, id: character.id, title: character.name, text: character.demoText };
  const change = (patch: Partial<Draft>) => setCharacter(c => {
    const settings = synthesisSettings({ ...draft, ...patch });
    return { ...c, demoText: patch.text ?? c.demoText, ...(selectedPerformance
      ? { performances: c.performances?.map(p => p.id === performanceId ? { ...p, settings } : p) }
      : { settings }) };
  });
  useEffect(() => {
    if (!pending) return;
    const result = state.previews?.find(p => p.id === pending);
    if (result) { setCharacter(c => ({ ...c, preview: result })); setTrack(null); setPending(null); }
    else if (state.activity?.requestId === pending && ['failed', 'cancelled', 'interrupted'].includes(state.activity.status)) {
      setError(formatActivityError(t, state.activity) ?? formatActivity(t, state.activity)); setPending(null);
    }
  }, [pending, state.previews, state.activity, t]);
  async function cleanup() { for (const id of temporary) await call('character.discardPreview', { id }); }
  const [confirmClose, setConfirmClose] = useState(false);
  async function finish(discard = false) {
    if (changed && !discard) { setConfirmClose(true); return; }
    setSaving(true);
    try { await cleanup(); close(); } catch (e) { setError(formatCallError(t, e)); } finally { setSaving(false); }
  }
  async function save(copy = false, use = false) {
    setSaving(true); setError('');
    try {
      const saved = await call<Character>('character.save', { ...character, id: copy ? crypto.randomUUID().replaceAll('-', '') : character.id });
      await cleanup();
      if (use && apply) await apply(saved); else close(saved);
    } catch (e) { setError(formatCallError(t, e)); } finally { setSaving(false); }
  }
  async function generate() {
    setRequesting(true); setError('');
    try { const id = await call<string>('character.preview', { ...character, settings: activeSettings }); setTemporary(ids => [...ids, id]); setPending(id); }
    catch (e) { setError(formatCallError(t, e)); } finally { setRequesting(false); }
  }
  const invalid = character.performances?.some(p => !p.name.trim() || p.name.length > 120 || character.performances!.filter(v => v.name.trim().toLowerCase() === p.name.trim().toLowerCase()).length > 1) ? '@yovoice.performance.invalid' : !character.name.trim() ? '@yovoice.library.nameRequired' : character.name.length > 120 ? '@yovoice.character.nameLimit' : character.demoText.length > 2000 ? '@yovoice.library.textLimit' : '';
  const existing = state.characters?.find(c => c.id === initial.id);
  const changed = stableJSON(character) !== stableJSON(existing ?? initial);
  const preview = character.preview;
  const demoTrack: Track | null = preview ? { id: preview.id, fileName: preview.fileName, name: character.name, kind: 'outputs', subtitle: '' } : null;
  const editorActions = <HStack gap={2}><Button label={t('@yovoice.character.close')} variant="secondary" isLoading={saving} isDisabled={editingBusy} onClick={() => void finish()} /><Button label={t('@yovoice.library.save')} variant="primary" isDisabled={editingBusy || !!invalid} onClick={() => void save()} />{apply ? <Button label={t('@yovoice.library.saveApply')} isDisabled={editingBusy || !!invalid} onClick={() => void save(false, true)} /> : null}</HStack>;
  const previewAction = <VStack gap={3}>
    <HStack className="inspector-document-actions" hAlign="end">{editorActions}</HStack>
    {pending && busy ? <Button label={t('@yovoice.create.cancelGenerate')} width="100%" onClick={() => { void call('operation.cancel').catch(e => setError(formatCallError(t, e))); }} /> : <Button label={t(preview ? '@yovoice.character.regenerate' : '@yovoice.character.preview')} variant="primary" width="100%" size="lg" isLoading={requesting || !!pending} isDisabled={editingBusy || busy || !!invalid || !character.demoText.trim()} onClick={() => void generate()} />}
    {pending && state.activity ? <small role="status">{formatActivity(t, state.activity)}</small> : null}
  </VStack>;
  return <>
    <VStack data-testid="character-editor" className="character-editor" data-character-active={active} gap={0} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        if (!choosing && !editingBusy && !busy && !invalid && character.demoText.trim()) void generate();
      }
    }}><Layout height="fill" padding={0} content={<Studio showInspector={showInspector} onShowInspector={() => setShowInspector(true)}
      title={<input className="document-title" aria-label={t('@yovoice.character.name')} placeholder={t('@yovoice.character.name')} value={character.name} onChange={event => setCharacter(c => ({ ...c, name: event.target.value }))} />}
      actions={editorActions} inspector={<Inspector draft={draft} state={state} catalog={catalog} change={change} chooseVoice={() => setChoosing('voice')} chooseEmotion={() => setChoosing('emotion')} play={value => setTrack({ ...value, playRequest: performance.now() })} generate={() => void generate()} cancel={() => {}} settings={() => settings(draft.modelId)} advanced={advanced} setAdvanced={setAdvanced} close={() => setShowInspector(false)} allowModelManagement generationAction={previewAction} libraryActions={<>
        <HStack gap={2} vAlign="end">
          <Selector label={t('@yovoice.performance.label')} width="100%" value={performanceId} isDisabled={editingBusy} options={[{ value: '', label: t('@yovoice.performance.default') }, ...(character.performances ?? []).map(p => ({ value: p.id, label: p.name }))]} onChange={id => { setPerformanceId(id); setTrack(null); }} />
          <Button size="md" isIconOnly icon={<Plus />} label={t('@yovoice.performance.add')} isDisabled={editingBusy || (character.performances?.length ?? 0) >= 32} onClick={() => {
            const id = crypto.randomUUID().replaceAll('-', '');
            let n = 1; while (character.performances?.some(p => p.name === t('@yovoice.performance.numbered', { n }))) n++;
            setCharacter(c => ({ ...c, performances: [...(c.performances ?? []), { id, name: t('@yovoice.performance.numbered', { n }), settings: activeSettings }] })); setPerformanceId(id); setTrack(null);
          }} />
          {selectedPerformance ? <DropdownMenu hasChevron={false} alignment="end" button={{ size: 'md', isIconOnly: true, icon: <Ellipsis />, label: t('@yovoice.performance.more'), isDisabled: editingBusy }} items={[
            { label: t('@yovoice.performance.rename'), icon: <Pencil />, onClick: () => setRename(selectedPerformance.name) },
            { label: t('@yovoice.performance.delete'), icon: <Trash2 />, variant: 'destructive', onClick: () => { setCharacter(c => ({ ...c, performances: c.performances?.filter(p => p.id !== performanceId) })); setPerformanceId(''); setTrack(null); } },
          ]} /> : null}
        </HStack>
        {!state.models.some(m => m.id === activeSettings.modelId) ? <Button label={t('@yovoice.create.manageModels')} onClick={() => settings(draft.modelId)} /> : null}
        {[activeSettings.voiceId, activeSettings.emotionVoiceId].some(id => id && !state.voices.some(v => v.id === id)) ? <p role="alert">{t('@yovoice.character.missingVoice')}</p> : null}
        {(activeSettings.voiceId || activeSettings.emotionVoiceId) ? <Button size="sm" variant="secondary" label={t('@yovoice.character.clearReferences')} onClick={() => change({ voiceId: null, emotionVoiceId: null, referenceText: '' })} /> : null}
      </>} />}>
      <textarea className="script-editor" aria-label={t('@yovoice.character.demo')} placeholder={t('@yovoice.character.example')} value={character.demoText} spellCheck={false} onChange={event => setCharacter(c => ({ ...c, demoText: event.target.value }))} />
      <HStack className="editor-status" hAlign="end"><small>{character.demoText.length} / 2000</small></HStack>
    </Studio>} footer={<LayoutFooter padding={0}><VStack gap={0}>
      {previewStale({ ...character, settings: activeSettings }) || (demoTrack && track) || invalid || error ? <HStack gap={3} paddingInline={4} paddingBlock={2} hAlign="between" vAlign="center" wrap="wrap">
        {previewStale({ ...character, settings: activeSettings }) ? <small role="status">{t('@yovoice.character.stale')}</small> : null}
        {demoTrack && track ? <Button size="sm" variant="secondary" label={t('@yovoice.character.listen')} onClick={() => setTrack(null)} /> : null}
        {invalid ? <small role="alert" className="dialog-error">{t(invalid)}</small> : null}
        {error ? <small role="alert">{formatNotice(t, error)}</small> : null}
      </HStack> : null}
      <Player track={track ?? demoTrack} suspended={!active || !!choosing} onError={setError} actions={existing ? <Button label={t('@yovoice.character.copy')} size="sm" isDisabled={editingBusy || !!invalid} onClick={() => void save(true)} /> : undefined} />
    </VStack></LayoutFooter>} /></VStack>
    {rename !== null && selectedPerformance ? <AppDialog title={t('@yovoice.performance.rename')} onClose={() => setRename(null)} actions={<>
      <Button label={t('@yovoice.action.cancel')} onClick={() => setRename(null)} />
      <Button label={t('@yovoice.performance.rename')} variant="primary" isDisabled={!rename.trim() || character.performances?.some(p => p.id !== performanceId && p.name.trim().toLowerCase() === rename.trim().toLowerCase())} onClick={() => { setCharacter(c => ({ ...c, performances: c.performances?.map(p => p.id === performanceId ? { ...p, name: rename.trim() } : p) })); setRename(null); }} />
    </>}><TextInput label={t('@yovoice.performance.name')} hasAutoFocus value={rename} onChange={name => setRename(name.slice(0, 120))} /></AppDialog> : null}
    {confirmClose ? <AppDialog title={t('@yovoice.library.unsaved')} onClose={() => setConfirmClose(false)} actions={<><Button label={t('@yovoice.library.continue')} onClick={() => setConfirmClose(false)} /><Button label={t('@yovoice.library.discard')} isDisabled={editingBusy} onClick={() => void finish(true)} /><Button label={t('@yovoice.library.save')} variant="primary" isDisabled={editingBusy || !!invalid} onClick={() => void save()} /></>}>{null}</AppDialog> : null}
    {choosing ? <Suspense fallback={<p role="status">{t('@yovoice.app.loadingVoicePicker')}</p>}><VoicePicker voices={state.voices} onClose={() => setChoosing(null)} onSelect={voice => { change(choosing === 'voice' ? { voiceId: voice.id, referenceText: voice.referenceText ?? '' } : { emotionVoiceId: voice.id }); setChoosing(null); }} /></Suspense> : null}
  </>;
}

export function CharacterLibrary({ state, catalog, create, edit, apply, onError, controls, active = true }: { controls?: ReactNode; active?: boolean; state: State; catalog: ModelPackage[]; create: () => void; edit: (c: Character) => void; apply: (c: Character) => void; onError: (message: string) => void }) {
  const t = useTranslator();
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Character | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const characters = state.characters ?? [];
  const filtered = characters.filter(c => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <LibraryPage title={t('@yovoice.nav.library')} controls={controls} layout="tickets"
      actions={characters.length ? <Button label={t('@yovoice.character.create')} size="sm" icon={<Plus />} onClick={create} /> : undefined}
      query={query} onQueryChange={setQuery} searchLabel={t('@yovoice.character.search')}
      hasItems={characters.length > 0} hasResults={filtered.length > 0} noResults={t('@yovoice.character.noResults')}
      empty={<LibraryEmpty icon={<AudioLines />} title={t('@yovoice.character.empty')} action={<Button label={t('@yovoice.character.create')} variant="primary" onClick={create} />} />}>
      {/* 角色是一张单曲唱片：头像是唱片标签，点卡片试听，播放时唱片转动；存根记着有几种演绎。 */}
      {filtered.map((c, index) => <Ticket key={c.id} index={index} className="character-row"
        cover={<RecordCover seed={c.id} interactive><Player compact avatar={{ seed: c.id, label: t('@yovoice.character.listen'), disabled: !c.preview, select: () => setPlaying(c.id) }} suspended={!active || !!deleting} track={playing === c.id && c.preview ? { id: c.preview.id, name: c.name, fileName: c.preview.fileName, kind: 'outputs', subtitle: '', playRequest: 1 } : null} onError={onError} /></RecordCover>}
        eyebrow={[catalog.find(m => m.id === c.settings.modelId)?.name ?? c.settings.modelId, t(!c.preview ? '@yovoice.character.emptyPreview' : previewStale(c) ? '@yovoice.character.stale' : '@yovoice.character.ready')].join(' · ')}
        title={<h3 title={c.name}>{c.name}</h3>} excerpt={c.demoText.trim()}
        stub={<TicketStamp value={(c.performances?.length ?? 0) + 1} unit={t('@yovoice.library.performanceUnit')} />}
        actions={<>
          <Button size="sm" label={t('@yovoice.character.apply')} onClick={() => apply(c)} />
          <Button size="sm" variant="ghost" isIconOnly icon={<Pencil />} label={t('@yovoice.character.edit')} onClick={() => { setPlaying(null); edit(c); }} />
          <Button size="sm" variant="ghost" isIconOnly icon={<Trash2 />} label={t('@yovoice.character.delete')} onClick={() => { setError(''); setDeleting(c); }} />
        </>} />)}
    </LibraryPage>
    {deleting ? <ConfirmDelete title={t('@yovoice.character.delete')} description={`${deleting.name} — ${t('@yovoice.character.deleteConfirm')}`}
      confirmLabel={t('@yovoice.character.delete')} busy={saving} error={formatNotice(t, error)} onClose={() => setDeleting(null)}
      onConfirm={() => { setSaving(true); setError(''); void call('character.delete', { id: deleting.id }).then(() => { setDeleting(null); setPlaying(null); }).catch(e => setError(formatCallError(t, e))).finally(() => setSaving(false)); }} /> : null}
  </>;
}
