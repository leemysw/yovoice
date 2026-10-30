import { AdvancedSettings, SeedInput, ReferenceVoice } from './shared-controls';
import { ModelOptions } from './model-options';
import { Selector } from '../../shared/selector';
import { Slider } from '@astryxdesign/core/Slider';
import attributes from '@internal/catalog/omni_attributes.json';
import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ChevronRight } from 'lucide-react';
import { requiresVoice, type Draft, type State, type Track } from '../../shared/workbench';

export function ReferenceControls({ draft, state, change, chooseVoice, play, advanced, setAdvanced }: {
  draft: Draft; state: State; change: (patch: Partial<Draft>) => void;
  advanced: boolean; setAdvanced: (open: boolean) => void;
  chooseVoice: () => void; play: (track: Track) => void;
}) {
  const t = useTranslator();
  const omni = draft.modelId.startsWith('omnivoice-');
  const custom = draft.modelId.includes('customvoice');
  const selectedAttributes = (draft.voiceDescription ?? '').toLowerCase().split(/[,，]/).map(value => value.trim());
  const cloning = requiresVoice(draft);
  const voice = state.voices.find(item => item.id === draft.voiceId);
  return <>
    {omni ? <VStack gap={3}>
      <h3>{t('@yovoice.vox.generationMode')}</h3>
      <SegmentedControl label={t('@yovoice.vox.generationMode')} size="sm" layout="fill" value={draft.voiceMode || 'design'} onChange={value => change({ voiceMode: value as Draft['voiceMode'] })}>
        <SegmentedControlItem value="design" label={t('@yovoice.vox.design')} />
        <SegmentedControlItem value="clone" label={t('@yovoice.vox.clone')} />
      </SegmentedControl>
    </VStack> : null}
    {custom ? <Selector label={t('@yovoice.reference.speaker')} value={draft.speaker || 'Vivian'} options={['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'].map(value => ({ value, label: value, description: t(`@yovoice.reference.speaker.${value}`) }))} onChange={speaker => change({ speaker })} /> : null}
    {cloning ? <>
      <ReferenceVoice voice={voice} choose={chooseVoice} play={play} />
      <TextArea label={t(omni ? '@yovoice.vox.referenceText' : '@yovoice.reference.transcript')} value={draft.referenceText ?? ''} onChange={referenceText => change({ referenceText: referenceText.slice(0, 2000) })} placeholder={t('@yovoice.vox.referenceTextPlaceholder')} rows={3} />
    </> : omni ? <VStack gap={3}>{Object.entries(attributes).map(([group, items]) => <Selector key={group} label={t(`@yovoice.reference.${group}`)} value={items.find(([value, alias]) => selectedAttributes.includes(value) || selectedAttributes.includes(alias))?.[0] ?? ''} options={[{ value: '', label: t('@yovoice.reference.auto') }, ...items.map(([value]) => ({ value, label: t(`@yovoice.reference.${value}`) }))]} onChange={value => change({ voiceDescription: [...selectedAttributes.filter(item => item && !items.some(pair => pair.includes(item))), ...(value ? [value] : [])].join(', ') })} />)}</VStack> : <VStack gap={2}><TextArea label={t('@yovoice.vox.voiceDescription')} value={draft.voiceDescription ?? ''} onChange={voiceDescription => change({ voiceDescription: voiceDescription.slice(0, 500) })} placeholder={t('@yovoice.vox.voiceDescriptionPlaceholder')} rows={3} /></VStack>}
    {omni ? <>
      <label className="number-field">{t('@yovoice.reference.omniLanguage')}<input value={draft.synthesisLanguage ?? ''} maxLength={32} placeholder="auto" onChange={event => change({ synthesisLanguage: event.target.value })} /></label>
      <Slider label={t('@yovoice.create.speed')} value={draft.omniSpeed || 1} min={0.5} max={2} step={0.05} onChange={(omniSpeed: number) => change({ omniSpeed })} valueDisplay="text" formatValue={value => `${value.toFixed(2)}×`} />
      <details className="advanced"><summary><ChevronRight size={16} aria-hidden="true" />{t('@yovoice.reference.tags')}</summary><VStack gap={3} paddingBlockStart={4}><Selector label={t('@yovoice.reference.tags')} value="" options={['laughter', 'sigh', 'confirmation-en', 'question-en', 'question-ah', 'question-oh', 'question-ei', 'question-yi', 'surprise-ah', 'surprise-oh', 'surprise-wa', 'surprise-yo', 'dissatisfaction-hnn'].map(value => ({ value, label: `[${value}]` }))} onChange={value => change({ text: `${draft.text} [${value}]` })} /></VStack></details>
    </> : <Selector label={t('@yovoice.create.language')} value={draft.synthesisLanguage || 'auto'} options={['auto', 'zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'].map(value => ({ value, label: value === 'auto' ? t('@yovoice.reference.auto') : t(`@yovoice.language.${value}`) }))} onChange={synthesisLanguage => change({ synthesisLanguage })} />}
    <AdvancedSettings open={advanced} onOpenChange={setAdvanced}>
      <ModelOptions draft={draft} family={omni ? 'omnivoice' : 'qwen3_tts'} change={change} />
    <SeedInput value={draft.seed} change={change} />
    </AdvancedSettings>
  </>;
}
