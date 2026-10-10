import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { useTranslator } from '@astryxdesign/core/i18n';
import { LoaderCircle } from 'lucide-react';
import { Selector, SelectorOption } from '../../shared/selector';
import definitions from '../../shared/lib/generation-options.json';
import { formatActivity } from '../../shared/i18n/format';
import { formatSize, formatTime, isMusicModel, type Draft, type ModelPackage, type State } from '../../shared/workbench';
import { AdvancedSettings, SeedInput } from '../create/shared-controls';
import { durationPresets, musicLanguages } from './music-draft';

const optionValues = (key: string) => definitions.ace_step.find(spec => spec.key === key)?.values ?? [];

// 音乐检查器：常用的时长和演唱语言放在外面，速度、调性、拍号等交给规划器自动决定，按需展开。
export function MusicInspector({ draft, state, catalog, change, generate, cancel, settings, close, advanced, setAdvanced, header }: {
  draft: Draft; state: State; catalog: ModelPackage[]; change: (patch: Partial<Draft>) => void; header?: ReactNode;
  generate: () => void; cancel: () => void; settings: () => void; close: () => void; advanced: boolean; setAdvanced: (value: boolean) => void;
}) {
  const t = useTranslator();
  const busy = state.activity?.status === 'running';
  const generating = busy && state.activity?.kind === 'generate' && state.activity.projectId === draft.id;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!generating) { setElapsed(0); return; }
    const started = state.activity?.startedAt ? Date.parse(state.activity.startedAt) : Date.now();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [generating, state.activity?.startedAt]);
  const options = draft.modelOptions?.ace_step ?? {};
  const option = (key: string, fallback: string | number) => options[key] ?? fallback;
  const update = (key: string, value: string | number) => change({ modelOptions: { ...draft.modelOptions, ace_step: { ...options, [key]: value } } });
  const duration = Number(option('duration_seconds', 0));
  const models = catalog.filter(model => isMusicModel(model.id));
  return <VStack as="aside" className="inspector music-inspector" gap={0}>
    <VStack className="generation-action" gap={3}>
      {generating ? <Button label={t('@yovoice.create.cancelGenerate')} onClick={cancel} width="100%" />
        : <Button label={t('@yovoice.music.generate')} variant="primary" width="100%" size="lg" aria-keyshortcuts="Control+Enter" isDisabled={busy || !draft.text.trim()} onClick={generate} />}
      {generating ? <HStack className="generation-status" gap={2} vAlign="center">
        <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />
        <small className="grow" role="status">{state.activity ? formatActivity(t, state.activity) : ''}</small>
        <small className="generation-elapsed" aria-label={t('@yovoice.create.elapsed')}>{formatTime(elapsed)}</small>
      </HStack> : <small>{t('@yovoice.music.generateHint')}</small>}
    </VStack>
    <VStack className="inspector-scroll" gap={5}>
      {header}
      <VStack className="inspector-actions" gap={3}>
        <HStack className="inspector-heading" hAlign="between" vAlign="center"><h2 className="inspector-section-title">{t('@yovoice.create.model')}</h2><Button label={t('@yovoice.create.backToScript')} className="inspector-toggle" variant="secondary" onClick={close} /></HStack>
        <Selector label={t('@yovoice.create.model')} isLabelHidden width="100%" className="model-selector" value={draft.modelId} isDisabled={busy}
          renderOption={item => <SelectorOption label={item.label} description={item.description} layout="inline" />} renderValue={item => item.label}
          options={[...models.map(model => ({ value: model.id, label: `${model.name} · ${model.precision}`, description: state.models.some(installed => installed.id === model.id) ? t('@yovoice.create.modelInstalled') : t('@yovoice.music.modelSize', { size: formatSize(model.size) }) })), { value: 'manage', label: t('@yovoice.create.manageModels') }]}
          onChange={modelId => { if (modelId === 'manage') settings(); else change({ modelId }); }} />
      </VStack>
      <VStack gap={3}>
        <h3>{t('@yovoice.music.duration')}</h3>
        <SegmentedControl label={t('@yovoice.music.duration')} size="sm" layout="fill" value={String(durationPresets.includes(duration as typeof durationPresets[number]) ? duration : '')} onChange={value => update('duration_seconds', Number(value))}>
          {durationPresets.map(value => <SegmentedControlItem key={value} value={String(value)} label={value ? formatTime(value) : t('@yovoice.music.auto')} />)}
        </SegmentedControl>
        <small>{duration ? t('@yovoice.music.durationFixed') : t('@yovoice.music.durationAuto')}</small>
      </VStack>
      <HStack className="language-row" vAlign="center" hAlign="between"><h3 aria-hidden="true">{t('@yovoice.music.language')}</h3>
        <Selector label={t('@yovoice.music.language')} isLabelHidden width="calc(var(--spacing-10) * 3)" value={draft.synthesisLanguage || 'zh'} options={musicLanguages.map(value => ({ value, label: t(`@yovoice.music.languageName.${value}`) }))} onChange={synthesisLanguage => change({ synthesisLanguage })} />
      </HStack>
      <AdvancedSettings open={advanced} onOpenChange={setAdvanced}>
        <label className="number-field">{t('@yovoice.music.duration')}<input type="number" min={0} max={300} step={1} value={duration || ''} placeholder={t('@yovoice.music.auto')} onChange={event => update('duration_seconds', event.target.value ? Number(event.target.value) : 0)} /></label>
        <label className="number-field">{t('@yovoice.music.bpm')}<input type="number" min={30} max={300} step={1} value={Number(option('bpm', 0)) || ''} placeholder={t('@yovoice.music.auto')} onChange={event => update('bpm', event.target.value ? Number(event.target.value) : 0)} /></label>
        <Selector label={t('@yovoice.music.keyscale')} value={String(option('keyscale', 'auto'))} options={optionValues('keyscale').map(value => ({ value, label: value === 'auto' ? t('@yovoice.music.auto') : value }))} onChange={value => update('keyscale', value)} />
        <Selector label={t('@yovoice.music.timesignature')} value={String(option('timesignature', 'auto'))} options={optionValues('timesignature').map(value => ({ value, label: value === 'auto' ? t('@yovoice.music.auto') : `${value}/${value === '6' ? 8 : 4}` }))} onChange={value => update('timesignature', value)} />
        <label className="number-field">{t('@yovoice.music.steps')}<input type="number" min={1} max={20} step={1} value={Number(option('num_inference_steps', 8))} onChange={event => { if (event.target.value) update('num_inference_steps', Number(event.target.value)); }} /></label>
        <SeedInput value={draft.seed} change={change} />
        <small>{t('@yovoice.music.advancedHint')}</small>
      </AdvancedSettings>
    </VStack>
  </VStack>;
}
