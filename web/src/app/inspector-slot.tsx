import { lazy, Suspense } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Plus, Save } from 'lucide-react';
import { Inspector } from '../features/create/inspector';
import { SpeakerAvatar } from '../features/create/subtitles';
import { Selector } from '../shared/selector';
import { call } from '../shared/lib/client';
import { performanceSettings, projectKind, type Character, type ModelPackage, type State, type Track } from '../shared/workbench';
import type { DraftSession } from './use-draft-session';
import type { StoryCueEditing } from './use-story-cue-editing';
// 音乐与编曲检查器按需加载，首屏主包只含语音检查器。
const MusicInspector = lazy(() => import('../features/music/music-inspector').then(module => ({ default: module.MusicInspector })));
const ScoreInspector = lazy(() => import('../features/score/score-inspector').then(module => ({ default: module.ScoreInspector })));

// 工作区右侧的检查器：按作品类型挑选编曲、音乐/音效或语音检查器；语音检查器顶部带角色与演绎的选择。
export function InspectorSlot({ draft, setDraft, change, state, catalog, generate, run, openSettings, setShowInspector, advanced, setAdvanced, cues, selectedCharacter, setVoicePicker, audition, createVoice, openCharacter, applyCharacter }: Pick<DraftSession, 'draft' | 'setDraft' | 'change'> & {
  state: State; catalog: ModelPackage[]; generate: () => void; run: (action: () => Promise<unknown>) => void; openSettings: (modelId?: string, requested?: string) => void;
  setShowInspector: (show: boolean) => void; advanced: boolean; setAdvanced: (value: boolean) => void;
  cues: Pick<StoryCueEditing, 'activeCue' | 'activeSpeaker' | 'selectedCue' | 'inspectorDraft' | 'changeSpeaker'>; selectedCharacter: string | null;
  setVoicePicker: (picker: 'voice' | 'emotion') => void; audition: (value: Track) => void;
  createVoice: () => void; openCharacter: () => void; applyCharacter: (c: Character) => void;
}) {
  const t = useTranslator();
  const { activeCue, activeSpeaker, selectedCue, inspectorDraft, changeSpeaker } = cues;
  const music = projectKind(draft) === 'music';
  const scoring = projectKind(draft) === 'score';
  const soundEffects = projectKind(draft) === 'sfx';
  const currentCharacter = state.characters.find(c => c.id === (activeSpeaker?.characterId ?? selectedCharacter));
  const currentPerformance = activeSpeaker ? activeCue?.performance : draft.performance;
  const performances = currentCharacter?.performances ?? [];
  return <Suspense fallback={null}>{scoring ? <ScoreInspector draft={draft} state={state} catalog={catalog} change={change} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => openSettings(draft.modelId)} close={() => setShowInspector(false)} /> : music || soundEffects ? <MusicInspector draft={draft} state={state} catalog={catalog} change={change} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => openSettings(draft.modelId)} upgradeEngine={() => openSettings(draft.modelId, 'engine')} close={() => setShowInspector(false)} advanced={advanced} setAdvanced={setAdvanced} soundEffects={soundEffects} /> : <Inspector libraryActions={<VStack gap={2}>
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
  </VStack>} catalog={catalog} close={() => setShowInspector(false)} draft={inspectorDraft} state={state} change={changeSpeaker} chooseVoice={() => setVoicePicker('voice')} chooseEmotion={() => setVoicePicker('emotion')} play={audition} generate={generate} cancel={() => run(() => call('operation.cancel'))} settings={() => openSettings(inspectorDraft.modelId)} advanced={advanced} setAdvanced={setAdvanced} />}</Suspense>;
}
