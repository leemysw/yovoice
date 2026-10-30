import { AdvancedSettings, SeedInput, ReferenceVoice } from './shared-controls';
import { KokoroControls } from './kokoro-controls';
import { ModelOptions } from './model-options';
import { useState, type ReactNode } from 'react';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Slider } from '@astryxdesign/core/Slider';
import { ModelSelector } from './model-selector';
import { Selector } from '../../shared/selector';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ChevronUp, ChevronRight, LoaderCircle } from 'lucide-react';
import { ReferenceControls } from './reference-controls';
import { VoxControls } from './vox-controls';
import { DesignCloneControls } from './design-clone-controls';
import { isVoiceModel, isReferenceModel, isVoxModel, isBreezeModel, isMingModel, isVoxtralModel, isPlapreModel, isXTTSModel, isGradiumModel, isDramaModel, formatTime, type Draft, type Mode, type State, type ModelPackage } from '../../shared/workbench';
import { VoxtralControls } from './voxtral-controls';
import { XTTSControls } from './xtts-controls';
import { GradiumControls } from './gradium-controls';
import type { Track } from '../../shared/workbench';
import { formatActivity } from '../../shared/i18n/format';
import { useElapsed } from '../../shared/lib/use-elapsed';

const modes: Mode[] = ['speaker', 'reference', 'vector', 'text'];
const emotionKeys = ['happy', 'angry', 'sad', 'afraid', 'disgusted', 'melancholy', 'surprised', 'calm'] as const;
const emotionPresets = [
  { id: 'calm', values: [0, 0, 0, 0, 0, 0, 0, 0.6] },
  { id: 'cheerful', values: [0.6, 0, 0, 0, 0, 0, 0.1, 0] },
  { id: 'gentle', values: [0.15, 0, 0, 0, 0, 0, 0, 0.5] },
  { id: 'delight', values: [0.4, 0, 0, 0, 0, 0, 0.35, 0] },
  { id: 'wistful', values: [0, 0, 0.35, 0, 0, 0.2, 0, 0.15] },
  { id: 'tense', values: [0, 0, 0, 0.35, 0, 0, 0.2, 0] },
  { id: 'angry', values: [0, 0.5, 0, 0, 0, 0, 0, 0] },
  { id: 'sad', values: [0, 0, 0.5, 0, 0, 0, 0, 0] },
  { id: 'afraid', values: [0, 0, 0, 0.45, 0, 0, 0, 0] },
  { id: 'disgusted', values: [0, 0, 0, 0, 0.45, 0, 0, 0] },
  { id: 'melancholy', values: [0, 0, 0, 0, 0, 0.5, 0, 0] },
  { id: 'surprised', values: [0, 0, 0, 0, 0, 0, 0.5, 0] },
] as const;

const advancedFields = [
  ['temperature', '@yovoice.create.temperature', 0.05, 2, 0.05],
  ['topP', 'Top P', 0.01, 1, 0.01],
  ['topK', 'Top K', 1, 200, 1],
  ['repetitionPenalty', '@yovoice.create.repetitionPenalty', 0.1, 20, 0.1],
  ['maxTokens', '@yovoice.create.maxTokens', 50, 4000, 50],
  ['intervalSilenceMs', '@yovoice.create.intervalSilence', 0, 2000, 50],
  ['numBeams', '@yovoice.create.numBeams', 1, 10, 1],
  ['lengthPenalty', '@yovoice.create.lengthPenalty', -2, 2, 0.1],
] as const;

export function Inspector({ draft, state, catalog, change, chooseVoice, chooseEmotion, play, generate, cancel, settings, advanced, setAdvanced, embedded = false, libraryActions, generationAction, allowModelManagement = true }: {
  embedded?: boolean; libraryActions?: ReactNode; generationAction?: ReactNode; allowModelManagement?: boolean;
  draft: Draft; state: State; catalog: ModelPackage[]; change: (patch: Partial<Draft>) => void; chooseVoice: () => void; chooseEmotion: () => void;
  play: (track: Track) => void; generate: () => void; cancel: () => void; settings: () => void; close?: () => void; advanced: boolean; setAdvanced: (v: boolean) => void;
}) {
  const t = useTranslator();
  const voice = state.voices.find(v => v.id === draft.voiceId); const emotion = state.voices.find(v => v.id === draft.emotionVoiceId);
  const selectedPreset = emotionPresets.find(preset => preset.values.every((value, i) => Math.abs(value - draft.emotions[i]) < 0.001));
  const busy = state.activity?.status === 'running';
  const generating = busy && state.activity?.kind === 'generate' && (!state.activity.projectId || state.activity.projectId === draft.id) && !state.activity.characterId;
  const [tuneEmotions, setTuneEmotions] = useState(false);
  const [moreEmotions, setMoreEmotions] = useState(false);
  const elapsed = useElapsed(generating, state.activity?.startedAt);
  const languageOptions = (draft.modelId.startsWith('index-2.5')
    ? (['zh', 'en', 'ja', 'es', 'ar'] as const)
    : (['zh', 'en'] as const)).map(value => ({ value, label: t(`@yovoice.language.${value}`) }));
  // 配音与角色只列语音模型。
  const voiceModels = catalog.filter(model => isVoiceModel(model.id));
  // 当前模型的目录条目；目录里没有（目录更新后模型下架）时，需要条目的控件不渲染，页面不崩。
  const currentModel = catalog.find(model => model.id === draft.modelId);
  return <VStack as="aside" className={embedded ? undefined : "inspector"} gap={0}>
    {!embedded ? <VStack className="generation-action" gap={3}>
      {generationAction ?? (generating ? <Button label={t('@yovoice.create.cancelGenerate')} onClick={cancel} width="100%" /> : <Button label={t('@yovoice.create.generate')} variant="primary" width="100%" aria-keyshortcuts="Control+Enter" isDisabled={busy || !(draft.subtitles ? draft.subtitles.cues.some(cue => cue.text.trim()) : draft.text.trim())} onClick={generate} />)}
      {generating && !generationAction ? <HStack className="generation-status" gap={2} vAlign="center">
        <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />
        <small className="grow" role="status">{state.activity ? formatActivity(t, state.activity) : ''}</small>
        <small className="generation-elapsed" aria-label={t('@yovoice.create.elapsed')}>{formatTime(elapsed)}</small>
      </HStack> : null}
    </VStack>
    : null}
    <VStack className={embedded ? undefined : "inspector-scroll"} gap={5}>
    {libraryActions}
    <VStack className="inspector-actions" gap={3}>
      <h2 className="inspector-section-title">{t('@yovoice.create.model')}</h2>
      <ModelSelector label={t('@yovoice.create.model')} models={voiceModels} state={state} value={draft.modelId} isDisabled={generating} manage={embedded || !allowModelManagement ? undefined : settings}
        onChange={modelId => { change({ modelId, speaker: catalog.find(model => model.id === modelId)?.family === catalog.find(model => model.id === draft.modelId)?.family && !modelId.startsWith('kokoro-') ? draft.speaker : '', synthesisLanguage: catalog.find(model => model.id === modelId)?.family === catalog.find(model => model.id === draft.modelId)?.family ? draft.synthesisLanguage : 'auto', voiceDescription: catalog.find(model => model.id === modelId)?.family === catalog.find(model => model.id === draft.modelId)?.family ? draft.voiceDescription : '', language: modelId.startsWith('index-2.5') || ['zh', 'en'].includes(draft.language) ? draft.language : 'zh' }); }} />

    </VStack>
    <h2 className="inspector-section-title">{t('@yovoice.create.voiceSettings')}</h2>
      {currentModel?.family === 'kokoro_tts' ? <KokoroControls advanced={advanced} setAdvanced={setAdvanced} draft={draft} model={currentModel} change={change} /> : isVoxtralModel(draft.modelId) && currentModel ? <VoxtralControls advanced={advanced} setAdvanced={setAdvanced} draft={draft} model={currentModel} change={change} /> : isXTTSModel(draft.modelId) ? <XTTSControls draft={draft} state={state} change={change} chooseVoice={chooseVoice} play={play} advanced={advanced} setAdvanced={setAdvanced} /> : isGradiumModel(draft.modelId) ? <GradiumControls draft={draft} change={change} advanced={advanced} setAdvanced={setAdvanced} /> : isReferenceModel(draft.modelId) ? <ReferenceControls advanced={advanced} setAdvanced={setAdvanced} draft={draft} state={state} change={change} chooseVoice={chooseVoice} play={play} /> : isBreezeModel(draft.modelId) || isMingModel(draft.modelId) || isPlapreModel(draft.modelId) || isDramaModel(draft.modelId) ? <DesignCloneControls draft={draft} model={catalog.find(model => model.id === draft.modelId)} state={state} change={change} chooseVoice={chooseVoice} play={play} advanced={advanced} setAdvanced={setAdvanced} /> : isVoxModel(draft.modelId) ? <VoxControls draft={draft} state={state} change={change} chooseVoice={chooseVoice} play={play} advanced={advanced} setAdvanced={setAdvanced} /> : <>
      <ReferenceVoice voice={voice} choose={chooseVoice} play={play} />
      <VStack gap={3}>
        <h3>{t('@yovoice.create.expression')}</h3>
        <SegmentedControl size="sm" label={t('@yovoice.create.expression')} value={draft.mode} onChange={mode => change({ mode: mode as Mode })} layout="fill">{modes.map(id => <SegmentedControlItem key={id} value={id} label={t(`@yovoice.create.mode.${id}`)} />)}</SegmentedControl>
        {draft.mode === 'reference' ? <ReferenceVoice voice={emotion} choose={chooseEmotion} play={play} label={t('@yovoice.create.mode.reference')} placeholder={t('@yovoice.create.addEmotionReference')} /> : null}
        {draft.mode === 'text' ? <VStack gap={3}>
          <TextArea label={t('@yovoice.create.emotionDescription')} isLabelHidden value={draft.emotionText} onChange={value => change({ emotionText: value.slice(0, 500) })} placeholder={t('@yovoice.create.emotionPlaceholder')} rows={3} isDisabled={draft.inferEmotion} />
          <Switch label={t('@yovoice.create.inferEmotion')} size="sm" value={draft.inferEmotion} onChange={value => change({ inferEmotion: value })} labelPosition="start" labelSpacing="spread" />
        </VStack> : null}
        {draft.mode === 'vector' ? <VStack gap={0}>
          <VStack gap={2} className="emotion-presets">
            <HStack hAlign="between" vAlign="center"><h3>{t('@yovoice.create.emotionPresets')}</h3><Button label={t('@yovoice.action.reset')} size="sm" variant="secondary" onClick={() => change({ emotions: Array(8).fill(0) })} /></HStack>
            <HStack className="emotion-preset-grid" gap={2} role="group" aria-label={t('@yovoice.create.emotionPresets')}>{emotionPresets.slice(0, 3).map(preset => <Button key={preset.id} label={t(`@yovoice.emotion.preset.${preset.id}`)} size="sm" variant="secondary" aria-pressed={selectedPreset === preset} onClick={() => change({ emotions: [...preset.values] })} />)}</HStack>
            {moreEmotions ? <HStack id="more-emotion-presets" className="emotion-preset-grid" gap={2} role="group" aria-label={t('@yovoice.create.moreEmotionPresets')}>{emotionPresets.slice(3).map(preset => <Button key={preset.id} label={t(`@yovoice.emotion.preset.${preset.id}`)} size="sm" variant="secondary" aria-pressed={selectedPreset === preset} onClick={() => change({ emotions: [...preset.values] })} />)}</HStack> : null}
            <Button className="emotion-disclosure" label={moreEmotions ? t('@yovoice.create.collapseEmotions') : t('@yovoice.create.moreEmotions')} size="sm" variant="ghost" icon={moreEmotions ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} aria-expanded={moreEmotions} aria-controls={moreEmotions ? 'more-emotion-presets' : undefined} onClick={() => setMoreEmotions(!moreEmotions)} />
          </VStack>
          <VStack gap={2}>
            <Button className="emotion-disclosure" label={t('@yovoice.create.tuneEmotions')} size="sm" variant="ghost" icon={tuneEmotions ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} aria-expanded={tuneEmotions} aria-controls={tuneEmotions ? 'emotion-sliders' : undefined} onClick={() => setTuneEmotions(!tuneEmotions)} />
            {tuneEmotions ? <VStack id="emotion-sliders" gap={3}>{emotionKeys.map((key, i) => <Slider key={key} label={t(`@yovoice.emotion.${key}`)} min={0} max={1} step={0.05} value={draft.emotions[i]} onChange={(value: number) => change({ emotions: draft.emotions.map((v, n) => n === i ? value : v) })} valueDisplay="text" formatValue={v => `${Math.round(v * 100)}%`} />)}</VStack> : null}
          </VStack>
        </VStack> : null}
        {draft.mode !== 'speaker' ? <Slider label={t('@yovoice.create.emotionStrength')} value={draft.emotionStrength} min={0} max={1} step={0.05} onChange={(value: number) => change({ emotionStrength: value })} valueDisplay="text" formatValue={v => `${Math.round(v * 100)}%`} /> : null}
      </VStack>
      <VStack gap={4}>
        <HStack className="language-row" vAlign="center" hAlign="between"><h3 aria-hidden="true">{t('@yovoice.create.language')}</h3><Selector label={t('@yovoice.create.language')} isLabelHidden width="calc(var(--spacing-10) * 3)" value={draft.language} options={languageOptions} onChange={language => change({ language })} /></HStack>
        <Slider label={t('@yovoice.create.speed')} value={draft.speed} min={0.5} max={2} step={0.05} onChange={(speed: number) => change({ speed })} valueDisplay="text" formatValue={v => `${v.toFixed(2)}×`} />
      </VStack>
      <AdvancedSettings open={advanced} onOpenChange={setAdvanced}>
        {['text', 'vector'].includes(draft.mode) ? <Switch label={t('@yovoice.create.randomEmotion')} size="sm" value={draft.randomEmotion} onChange={randomEmotion => change({ randomEmotion })} /> : null}
        <Switch label={t('@yovoice.create.doSample')} size="sm" value={draft.doSample} onChange={v => change({ doSample: v })} />
        {advancedFields.map(([key, labelKey, min, max, step]) => <label key={key} className="number-field">{labelKey.startsWith('@') ? t(labelKey) : labelKey}<input type="number" min={min} max={max} step={step} value={draft[key]} onChange={e => { if (e.target.value !== '') change({ [key]: Number(e.target.value) }); }} /></label>)}
        <ModelOptions draft={draft} family="index_tts2" change={change} />
        <SeedInput value={draft.seed} change={change} />
      </AdvancedSettings>
      </>}
    </VStack>

  </VStack>;
}
