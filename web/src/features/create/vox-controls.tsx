import { AdvancedSettings, SeedInput, ReferenceVoice } from './shared-controls';
import { ModelOptions } from './model-options';
import { RecognizeField } from './recognize-field';
import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Slider } from '@astryxdesign/core/Slider';
import { useTranslator } from '@astryxdesign/core/i18n';
import type { Draft, State, Track } from '../../shared/workbench';

export function VoxControls({ draft, state, change, chooseVoice, play, advanced, setAdvanced }: {
  draft: Draft; state: State; change: (patch: Partial<Draft>) => void; chooseVoice: () => void;
  play: (track: Track) => void; advanced: boolean; setAdvanced: (value: boolean) => void;
}) {
  const t = useTranslator();
  const mode = draft.voxMode || 'design';
  const voice = state.voices.find(item => item.id === draft.voiceId);
  return <>
    <VStack gap={3}>
      <h3>{t('@yovoice.vox.generationMode')}</h3>
      <SegmentedControl label={t('@yovoice.vox.generationMode')} size="sm" layout="fill" value={mode} onChange={value => change({ voxMode: value as Draft['voxMode'] })}>
        <SegmentedControlItem value="design" label={t('@yovoice.vox.design')} />
        <SegmentedControlItem value="clone" label={t('@yovoice.vox.clone')} />
        <SegmentedControlItem value="continuation" label={t('@yovoice.vox.continuation')} />
      </SegmentedControl>
    </VStack>
    {mode !== 'design' ? <ReferenceVoice voice={voice} choose={chooseVoice} play={play} /> : null}
    {mode === 'continuation' ? <RecognizeField state={state} voiceId={draft.voiceId} apply={text => change({ referenceText: text.slice(0, 2000) })}>
      <TextArea label={t('@yovoice.vox.referenceText')} value={draft.referenceText ?? ''} onChange={value => change({ referenceText: value.slice(0, 2000) })} placeholder={t('@yovoice.vox.referenceTextPlaceholder')} rows={4} />
    </RecognizeField> :
      <TextArea label={mode === 'design' ? t('@yovoice.vox.voiceDescription') : t('@yovoice.vox.styleGuidance')} value={draft.voiceDescription ?? ''} onChange={value => change({ voiceDescription: value.slice(0, 500) })} placeholder={mode === 'design' ? t('@yovoice.vox.voiceDescriptionPlaceholder') : t('@yovoice.vox.stylePlaceholder')} rows={3} />}
    <AdvancedSettings open={advanced} onOpenChange={setAdvanced}>
        <Slider label={t('@yovoice.vox.guidanceScale')} value={draft.guidanceScale || 2} min={0.5} max={5} step={0.1} onChange={(guidanceScale: number) => change({ guidanceScale })} valueDisplay="text" formatValue={value => value.toFixed(1)} />
        <label className="number-field">{t('@yovoice.vox.inferenceSteps')}<input type="number" min={1} max={50} value={draft.inferenceSteps || 10} onChange={event => { if (event.target.value) change({ inferenceSteps: Number(event.target.value) }); }} /></label>
        <ModelOptions draft={draft} family="voxcpm2" change={change} omit={draft.runtime?.streaming ? ['retry_badcase', 'retry_badcase_max_times', 'retry_badcase_ratio_threshold'] : []} />
        <SeedInput value={draft.seed} change={change} />
      </AdvancedSettings>
  </>;
}
