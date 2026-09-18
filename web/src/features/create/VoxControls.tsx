import { ModelOptions } from './ModelOptions';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Slider } from '@astryxdesign/core/Slider';
import { useTranslator } from '@astryxdesign/core/i18n';
import { AudioLines, Play, ChevronRight } from 'lucide-react';
import type { Draft, State, Track } from '../../shared/workbench';

export function VoxControls({ draft, state, change, chooseVoice, play, advanced, setAdvanced }: {
  draft: Draft; state: State; change: (patch: Partial<Draft>) => void; chooseVoice: () => void;
  play: (track: Track) => void; advanced: boolean; setAdvanced: (value: boolean) => void;
}) {
  const t = useTranslator();
  const mode = draft.voxMode || 'design';
  const voice = state.voices.find(item => item.id === draft.voiceId);
  const modeHelp = mode === 'design' ? t('@yovoice.vox.designHelp') : mode === 'clone' ? t('@yovoice.vox.cloneHelp') : t('@yovoice.vox.continuationHelp');
  return <>
    <VStack gap={3}>
      <h3>{t('@yovoice.vox.generationMode')}</h3>
      <SegmentedControl label={t('@yovoice.vox.generationMode')} size="sm" layout="fill" value={mode} onChange={value => change({ voxMode: value as Draft['voxMode'] })}>
        <SegmentedControlItem value="design" label={t('@yovoice.vox.design')} />
        <SegmentedControlItem value="clone" label={t('@yovoice.vox.clone')} />
        <SegmentedControlItem value="continuation" label={t('@yovoice.vox.continuation')} />
      </SegmentedControl>
      <p className="muted helper">{modeHelp}</p>
    </VStack>
    {mode !== 'design' ? <VStack gap={3}>
      <h3>{t('@yovoice.create.referenceVoice')}</h3>
      <HStack className="voice-selected" gap={3} vAlign="center">
        <Button label={voice?.name ?? t('@yovoice.create.addReference')} icon={<AudioLines className="voice-mark" size={20} />} variant="ghost" className="voice-title grow" onClick={chooseVoice} />
        {voice ? <Button label={t('@yovoice.create.previewVoice')} isIconOnly icon={<Play size={17} />} variant="ghost" onClick={() => play({ ...voice, kind: 'voices', subtitle: t('@yovoice.app.subtitleReference') })} /> : null}
      </HStack>
    </VStack> : null}
    {mode === 'continuation' ? <TextArea label={t('@yovoice.vox.referenceText')} value={draft.referenceText ?? ''} onChange={value => change({ referenceText: value.slice(0, 2000) })} placeholder={t('@yovoice.vox.referenceTextPlaceholder')} rows={4} /> :
      <TextArea label={mode === 'design' ? t('@yovoice.vox.voiceDescription') : t('@yovoice.vox.styleGuidance')} value={draft.voiceDescription ?? ''} onChange={value => change({ voiceDescription: value.slice(0, 500) })} placeholder={mode === 'design' ? t('@yovoice.vox.voiceDescriptionPlaceholder') : t('@yovoice.vox.stylePlaceholder')} rows={3} />}
    <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)} className="advanced">
      <summary><ChevronRight size={16} aria-hidden="true" />{t('@yovoice.create.advanced')}</summary>
      <VStack gap={4} paddingBlockStart={4}>
        <Slider label={t('@yovoice.vox.guidanceScale')} value={draft.guidanceScale || 2} min={0.5} max={5} step={0.1} onChange={(guidanceScale: number) => change({ guidanceScale })} valueDisplay="text" formatValue={value => value.toFixed(1)} />
        <p className="muted helper">{t('@yovoice.vox.guidanceHelp')}</p>
        <label className="number-field">{t('@yovoice.vox.inferenceSteps')}<input type="number" min={1} max={50} value={draft.inferenceSteps || 10} onChange={event => { if (event.target.value) change({ inferenceSteps: Number(event.target.value) }); }} /></label>
        <ModelOptions draft={draft} family="voxcpm2" change={change} />
        <label className="number-field">{t('@yovoice.create.seed')}<input type="number" min={0} max={2147483647} value={draft.seed ?? ''} placeholder={t('@yovoice.create.seedAuto')} onChange={event => change({ seed: event.target.value ? Number(event.target.value) : null })} /></label>
      </VStack>
    </details>
  </>;
}
