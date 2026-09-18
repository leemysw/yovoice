import { ModelOptions } from './ModelOptions';
import { useEffect, useState } from 'react';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Slider } from '@astryxdesign/core/Slider';
import { Selector, SelectorOption } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { useTranslator } from '@astryxdesign/core/i18n';
import { AudioLines, ChevronUp, ChevronRight, Play, LoaderCircle } from 'lucide-react';
import { ReferenceControls } from './ReferenceControls';
import { VoxControls } from './VoxControls';
import { isReferenceModel, isVoxModel, formatTime, type Draft, type Mode, type State, type ModelPackage } from '../../shared/workbench';
import type { Track } from '../../shared/workbench';
import { formatActivity } from '../../shared/i18n/format';

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

export function Inspector({ draft, state, catalog, change, chooseVoice, chooseEmotion, play, generate, cancel, settings, advanced, setAdvanced, close }: {
  draft: Draft; state: State; catalog: ModelPackage[]; change: (patch: Partial<Draft>) => void; chooseVoice: () => void; chooseEmotion: () => void;
  play: (track: Track) => void; generate: () => void; cancel: () => void; settings: () => void; close: () => void; advanced: boolean; setAdvanced: (v: boolean) => void;
}) {
  const t = useTranslator();
  const voice = state.voices.find(v => v.id === draft.voiceId); const emotion = state.voices.find(v => v.id === draft.emotionVoiceId);
  const selectedPreset = emotionPresets.find(preset => preset.values.every((value, i) => Math.abs(value - draft.emotions[i]) < 0.001));
  const busy = state.activity?.status === 'running';
  const generating = busy && state.activity?.kind === 'generate';
  const [tuneEmotions, setTuneEmotions] = useState(false);
  const [moreEmotions, setMoreEmotions] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!generating) { setElapsed(0); return; }
    const started = state.activity?.startedAt ? Date.parse(state.activity.startedAt) : Date.now();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [generating, state.activity?.startedAt]);
  const languageOptions = (draft.modelId.startsWith('index-2.5')
    ? (['zh', 'en', 'ja', 'es', 'ar'] as const)
    : (['zh', 'en'] as const)).map(value => ({ value, label: t(`@yovoice.language.${value}`) }));
  return <VStack as="aside" className="inspector" gap={0}>
    <VStack className="generation-action" gap={3}>
      {busy && state.activity?.kind === 'generate' ? <Button label={t('@yovoice.create.cancelGenerate')} onClick={cancel} width="100%" /> : <Button label={t('@yovoice.create.generate')} variant="primary" width="100%" size="lg" aria-keyshortcuts="Control+Enter" isDisabled={busy || !draft.text.trim()} onClick={generate} />}
      {generating ? <HStack className="generation-status" gap={2} vAlign="center">
        <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />
        <small className="grow" role="status">{state.activity ? formatActivity(t, state.activity) : ''}</small>
        <small className="generation-elapsed" aria-label={t('@yovoice.create.elapsed')}>{formatTime(elapsed)}</small>
      </HStack> : null}
    </VStack>
    <VStack className="inspector-scroll" gap={5}>
    <VStack className="inspector-actions" gap={3}>
      <h2 className="inspector-section-title">{t('@yovoice.create.model')}</h2>
      <Selector label={t('@yovoice.create.model')} isLabelHidden placement="below" renderOption={option => <SelectorOption label={option.label} description={option.description} layout="inline" />} renderValue={option => option.label} className="model-selector" width="100%" value={draft.modelId} isDisabled={busy}
        options={[...catalog.map(model => ({ value: model.id, label: `${model.name} · ${model.precision}`, description: state.models.some(installed => installed.id === model.id) ? t('@yovoice.create.modelInstalled') : t('@yovoice.create.modelMissing') })), { value: 'manage', label: t('@yovoice.create.manageModels') }]}
        onChange={modelId => { if (modelId === 'manage') { settings(); return; } change({ modelId, synthesisLanguage: catalog.find(model => model.id === modelId)?.family === catalog.find(model => model.id === draft.modelId)?.family ? draft.synthesisLanguage : 'auto', voiceDescription: catalog.find(model => model.id === modelId)?.family === catalog.find(model => model.id === draft.modelId)?.family ? draft.voiceDescription : '', language: modelId.startsWith('index-2.5') || ['zh', 'en'].includes(draft.language) ? draft.language : 'zh' }); }} />

    </VStack>
    <HStack className="inspector-heading" hAlign="between" vAlign="center"><h2 className="inspector-section-title">{t('@yovoice.create.voiceSettings')}</h2><Button label={t('@yovoice.create.backToScript')} className="inspector-toggle" variant="ghost" onClick={close} /></HStack>
      {isReferenceModel(draft.modelId) ? <ReferenceControls draft={draft} state={state} change={change} chooseVoice={chooseVoice} play={play} /> : isVoxModel(draft.modelId) ? <VoxControls draft={draft} state={state} change={change} chooseVoice={chooseVoice} play={play} advanced={advanced} setAdvanced={setAdvanced} /> : <>
      <VStack gap={3}>
        <h3>{t('@yovoice.create.referenceVoice')}</h3>
        <HStack className="voice-selected" gap={3} vAlign="center">
          <Button label={voice?.name ?? t('@yovoice.create.addReference')} icon={<AudioLines className="voice-mark" size={20} />} variant="ghost" className="voice-title grow" onClick={chooseVoice} />
          {voice ? <Button label={t('@yovoice.create.previewVoice')} isIconOnly icon={<Play size={17} />} variant="ghost" onClick={() => play({ ...voice, kind: 'voices', subtitle: t('@yovoice.app.subtitleReference') })} /> : null}
        </HStack>
      </VStack>
      <VStack gap={3}>
        <h3>{t('@yovoice.create.expression')}</h3>
        <SegmentedControl size="sm" label={t('@yovoice.create.expression')} value={draft.mode} onChange={mode => change({ mode: mode as Mode })} layout="fill">{modes.map(id => <SegmentedControlItem key={id} value={id} label={t(`@yovoice.create.mode.${id}`)} />)}</SegmentedControl>
        {draft.mode === 'speaker' ? <p className="muted helper">{t('@yovoice.create.mode.speakerHelp')}</p> : null}
        {draft.mode === 'reference' ? <VStack gap={3}><Button label={emotion?.name ?? t('@yovoice.create.addEmotionReference')} icon={<AudioLines size={17} />} onClick={chooseEmotion} width="100%" /><p className="muted helper">{t('@yovoice.create.mode.referenceHelp')}</p></VStack> : null}
        {draft.mode === 'text' ? <VStack gap={3}>
          <TextArea label={t('@yovoice.create.emotionDescription')} isLabelHidden value={draft.emotionText} onChange={value => change({ emotionText: value.slice(0, 500) })} placeholder={t('@yovoice.create.emotionPlaceholder')} rows={3} isDisabled={draft.inferEmotion} />
          <Switch label={t('@yovoice.create.inferEmotion')} size="sm" value={draft.inferEmotion} onChange={value => change({ inferEmotion: value })} labelPosition="start" labelSpacing="spread" />
        </VStack> : null}
        {draft.mode === 'vector' ? <VStack gap={0}>
          <VStack gap={2} className="emotion-presets">
            <HStack hAlign="between" vAlign="center"><h3>{t('@yovoice.create.emotionPresets')}</h3><Button label={t('@yovoice.action.reset')} size="sm" variant="ghost" onClick={() => change({ emotions: Array(8).fill(0) })} /></HStack>
            <HStack className="emotion-preset-grid" gap={2} role="group" aria-label={t('@yovoice.create.emotionPresets')}>{emotionPresets.slice(0, 3).map(preset => <Button key={preset.id} label={t(`@yovoice.emotion.preset.${preset.id}`)} size="sm" variant="ghost" aria-pressed={selectedPreset === preset} onClick={() => change({ emotions: [...preset.values] })} />)}</HStack>
            {moreEmotions ? <HStack id="more-emotion-presets" className="emotion-preset-grid" gap={2} role="group" aria-label={t('@yovoice.create.moreEmotionPresets')}>{emotionPresets.slice(3).map(preset => <Button key={preset.id} label={t(`@yovoice.emotion.preset.${preset.id}`)} size="sm" variant="ghost" aria-pressed={selectedPreset === preset} onClick={() => change({ emotions: [...preset.values] })} />)}</HStack> : null}
            <Button className="emotion-disclosure" label={moreEmotions ? t('@yovoice.create.collapseEmotions') : t('@yovoice.create.moreEmotions')} size="sm" variant="ghost" icon={moreEmotions ? <ChevronUp aria-hidden="true" /> : <ChevronRight aria-hidden="true" />} aria-expanded={moreEmotions} aria-controls={moreEmotions ? 'more-emotion-presets' : undefined} onClick={() => setMoreEmotions(!moreEmotions)} />
          </VStack>
          <VStack gap={2}>
            <Button className="emotion-disclosure" label={t('@yovoice.create.tuneEmotions')} size="sm" variant="ghost" icon={tuneEmotions ? <ChevronUp aria-hidden="true" /> : <ChevronRight aria-hidden="true" />} aria-expanded={tuneEmotions} aria-controls={tuneEmotions ? 'emotion-sliders' : undefined} onClick={() => setTuneEmotions(!tuneEmotions)} />
            {tuneEmotions ? <VStack id="emotion-sliders" gap={3}>{emotionKeys.map((key, i) => <Slider key={key} label={t(`@yovoice.emotion.${key}`)} min={0} max={1} step={0.05} value={draft.emotions[i]} onChange={(value: number) => change({ emotions: draft.emotions.map((v, n) => n === i ? value : v) })} valueDisplay="text" formatValue={v => `${Math.round(v * 100)}%`} />)}</VStack> : null}
          </VStack>
        </VStack> : null}
        {draft.mode !== 'speaker' ? <Slider label={t('@yovoice.create.emotionStrength')} value={draft.emotionStrength} min={0} max={1} step={0.05} onChange={(value: number) => change({ emotionStrength: value })} valueDisplay="text" formatValue={v => `${Math.round(v * 100)}%`} /> : null}
      </VStack>
      <VStack gap={4}>
        <HStack className="language-row" vAlign="center" hAlign="between"><h3 aria-hidden="true">{t('@yovoice.create.language')}</h3><Selector placement="below" label={t('@yovoice.create.language')} isLabelHidden width="calc(var(--spacing-10) * 3)" value={draft.language} options={languageOptions} onChange={language => change({ language })} /></HStack>
        <Slider label={t('@yovoice.create.speed')} value={draft.speed} min={0.5} max={2} step={0.05} onChange={(speed: number) => change({ speed })} valueDisplay="text" formatValue={v => `${v.toFixed(2)}×`} />
      </VStack>
      <details open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)} className="advanced"><summary><ChevronRight size={16} aria-hidden="true" />{t('@yovoice.create.advanced')}</summary><VStack gap={4} paddingBlockStart={4}>
        {['text', 'vector'].includes(draft.mode) ? <Switch label={t('@yovoice.create.randomEmotion')} size="sm" value={draft.randomEmotion} onChange={randomEmotion => change({ randomEmotion })} /> : null}
        <Switch label={t('@yovoice.create.doSample')} size="sm" value={draft.doSample} onChange={v => change({ doSample: v })} />
        {advancedFields.map(([key, labelKey, min, max, step]) => <label key={key} className="number-field">{labelKey.startsWith('@') ? t(labelKey) : labelKey}<input type="number" min={min} max={max} step={step} value={draft[key]} onChange={e => { if (e.target.value !== '') change({ [key]: Number(e.target.value) }); }} /></label>)}
        <ModelOptions draft={draft} family="index_tts2" change={change} />
        <label className="number-field">{t('@yovoice.create.seed')}<input type="number" min={0} max={2147483647} value={draft.seed ?? ''} placeholder={t('@yovoice.create.seedAuto')} onChange={e => change({ seed: e.target.value ? Number(e.target.value) : null })} /></label>
      </VStack></details>
      </>}
    </VStack>

  </VStack>;
}
