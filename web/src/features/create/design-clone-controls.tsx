import { AdvancedSettings, SeedInput, ReferenceVoice } from './shared-controls';
import { ModelOptions } from './model-options';
import { RecognizeField } from './recognize-field';
import { Selector } from '../../shared/selector';
import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { isDramaModel, isMingModel, isPlapreModel, type Draft, type ModelPackage, type State, type Track } from '../../shared/workbench';

// Breeze、Ming、Plapre 与 Drama 共用模式切换；非克隆一侧和参考原文要求按模型区分。
export function DesignCloneControls({ draft, model, state, change, chooseVoice, play, advanced, setAdvanced }: {
  draft: Draft; model?: ModelPackage; state: State; change: (patch: Partial<Draft>) => void; chooseVoice: () => void;
  play: (track: Track) => void; advanced: boolean; setAdvanced: (value: boolean) => void;
}) {
  const t = useTranslator();
  const ming = isMingModel(draft.modelId);
  const plapre = isPlapreModel(draft.modelId);
  const drama = isDramaModel(draft.modelId);
  const cloning = draft.voiceMode === 'clone';
  const voice = state.voices.find(item => item.id === draft.voiceId);
  return <>
    <VStack gap={3}>
      <h3>{t('@yovoice.vox.generationMode')}</h3>
      <SegmentedControl label={t('@yovoice.vox.generationMode')} size="sm" layout="fill" value={cloning ? 'clone' : 'design'} onChange={value => change({ voiceMode: value as Draft['voiceMode'] })}>
        <SegmentedControlItem value="design" label={t(plapre ? '@yovoice.reference.builtInVoice' : drama ? '@yovoice.reference.defaultVoice' : '@yovoice.vox.design')} />
        <SegmentedControlItem value="clone" label={t('@yovoice.vox.clone')} />
      </SegmentedControl>
    </VStack>
    {cloning ? <>
      <ReferenceVoice voice={voice} choose={chooseVoice} play={play} />
      <RecognizeField state={state} voiceId={draft.voiceId} apply={text => change({ referenceText: text.slice(0, 2000) })}>
        <TextArea label={t(ming || plapre ? '@yovoice.reference.transcript' : '@yovoice.vox.referenceText')} description={t(drama ? '@yovoice.drama.referenceTextHelp' : ming || plapre ? '@yovoice.reference.transcriptHelp' : '@yovoice.breeze.referenceTextHelp')} isRequired={drama} value={draft.referenceText ?? ''} onChange={referenceText => change({ referenceText: referenceText.slice(0, 2000) })} placeholder={t('@yovoice.vox.referenceTextPlaceholder')} rows={3} />
      </RecognizeField>
    </> : null}
    {plapre && !cloning ? <Selector label={t('@yovoice.reference.speaker')} value={draft.speaker || model?.voices?.[0]} options={(model?.voices ?? []).map(value => ({ value, label: value }))} onChange={speaker => change({ speaker })} /> : null}
    {!plapre && !drama && (!ming || !cloning) ? <TextArea label={cloning ? t('@yovoice.vox.styleGuidance') : t('@yovoice.vox.voiceDescription')} description={t(ming ? '@yovoice.reference.voiceDesignHelp' : '@yovoice.breeze.instructionHelp')} value={draft.voiceDescription ?? ''} onChange={voiceDescription => change({ voiceDescription: voiceDescription.slice(0, 500) })} placeholder={cloning ? t('@yovoice.vox.stylePlaceholder') : t('@yovoice.breeze.voiceDescriptionPlaceholder')} rows={3} /> : null}
    {ming ? <Selector label={t('@yovoice.create.language')} value={draft.synthesisLanguage || 'auto'} options={['auto', 'zh', 'en', 'ja', 'ko', 'de', 'fr', 'es'].map(value => ({ value, label: value === 'auto' ? t('@yovoice.reference.auto') : t(`@yovoice.language.${value}`) }))} onChange={synthesisLanguage => change({ synthesisLanguage })} /> : null}
    <AdvancedSettings open={advanced} onOpenChange={setAdvanced}>
      <ModelOptions draft={draft} family={ming ? 'ming3_tts' : plapre ? 'plapre' : drama ? 'fish_drama3' : 'breeze_tts'} change={change} />
      <SeedInput value={draft.seed} change={change} />
    </AdvancedSettings>
  </>;
}
