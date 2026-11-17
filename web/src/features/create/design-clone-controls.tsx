import { AdvancedSettings, SeedInput, ReferenceVoice } from './shared-controls';
import { ModelOptions } from './model-options';
import { RecognizeField } from './recognize-field';
import { Selector } from '../../shared/selector';
import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { isAudio8Model, isDramaModel, isMingModel, isPlapreModel, type Draft, type ModelPackage, type State, type Track } from '../../shared/workbench';
import { overflowTitle } from '../../shared/ui/overflow-title';

// Breeze、Ming、Plapre、Drama 与 Audio8 共用模式切换；非克隆一侧和参考原文要求按模型区分。
// Drama 与 Audio8 同源（Fish Audio S2）：默认音色或克隆，克隆必须填原文，没有声音描述。
export function DesignCloneControls({ draft, model, state, change, chooseVoice, play, advanced, setAdvanced }: {
  draft: Draft; model?: ModelPackage; state: State; change: (patch: Partial<Draft>) => void; chooseVoice: () => void;
  play: (track: Track) => void; advanced: boolean; setAdvanced: (value: boolean) => void;
}) {
  const t = useTranslator();
  const ming = isMingModel(draft.modelId);
  const plapre = isPlapreModel(draft.modelId);
  const audio8 = isAudio8Model(draft.modelId);
  // fishLike：默认音色 + 必填原文的克隆，Drama 与 Audio8 一致。
  const fishLike = isDramaModel(draft.modelId) || audio8;
  const cloning = draft.voiceMode === 'clone';
  const voice = state.voices.find(item => item.id === draft.voiceId);
  return <>
    <VStack gap={3}>
      <h3>{t('@yovoice.vox.generationMode')}</h3>
      <SegmentedControl label={t('@yovoice.vox.generationMode')} size="sm" layout="fill" value={cloning ? 'clone' : 'design'} onChange={value => change({ voiceMode: value as Draft['voiceMode'] })}>
        <SegmentedControlItem onPointerEnter={overflowTitle} value="design" label={t(plapre ? '@yovoice.reference.builtInVoice' : fishLike ? '@yovoice.reference.defaultVoice' : '@yovoice.vox.design')} />
        <SegmentedControlItem onPointerEnter={overflowTitle} value="clone" label={t('@yovoice.vox.clone')} />
      </SegmentedControl>
    </VStack>
    {cloning ? <>
      <ReferenceVoice voice={voice} choose={chooseVoice} play={play} />
      <RecognizeField state={state} voiceId={draft.voiceId} apply={text => change({ referenceText: text.slice(0, 2000) })}>
        <TextArea label={t(ming || plapre ? '@yovoice.reference.transcript' : '@yovoice.vox.referenceText')} description={t(fishLike ? '@yovoice.drama.referenceTextHelp' : ming || plapre ? '@yovoice.reference.transcriptHelp' : '@yovoice.breeze.referenceTextHelp')} isRequired={fishLike} value={draft.referenceText ?? ''} onChange={referenceText => change({ referenceText: referenceText.slice(0, 2000) })} placeholder={t('@yovoice.vox.referenceTextPlaceholder')} rows={3} />
      </RecognizeField>
    </> : null}
    {plapre && !cloning ? <Selector label={t('@yovoice.reference.speaker')} value={draft.speaker || model?.voices?.[0]} options={(model?.voices ?? []).map(value => ({ value, label: value }))} onChange={speaker => change({ speaker })} /> : null}
    {!plapre && !fishLike && (!ming || !cloning) ? <TextArea label={cloning ? t('@yovoice.vox.styleGuidance') : t('@yovoice.vox.voiceDescription')} description={t(ming ? '@yovoice.reference.voiceDesignHelp' : '@yovoice.breeze.instructionHelp')} value={draft.voiceDescription ?? ''} onChange={voiceDescription => change({ voiceDescription: voiceDescription.slice(0, 500) })} placeholder={cloning ? t('@yovoice.vox.stylePlaceholder') : t('@yovoice.breeze.voiceDescriptionPlaceholder')} rows={3} /> : null}
    {ming ? <Selector label={t('@yovoice.create.language')} value={draft.synthesisLanguage || 'auto'} options={['auto', 'zh', 'en', 'ja', 'ko', 'de', 'fr', 'es'].map(value => ({ value, label: value === 'auto' ? t('@yovoice.reference.auto') : t(`@yovoice.language.${value}`) }))} onChange={synthesisLanguage => change({ synthesisLanguage })} /> : null}
    <AdvancedSettings open={advanced} onOpenChange={setAdvanced}>
      <ModelOptions draft={draft} family={ming ? 'ming3_tts' : plapre ? 'plapre' : audio8 ? 'audio8_tts' : fishLike ? 'fish_drama3' : 'breeze_tts'} change={change} />
      <SeedInput value={draft.seed} change={change} />
    </AdvancedSettings>
  </>;
}
