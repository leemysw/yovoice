import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { LoaderCircle } from 'lucide-react';
import { Selector, SelectorOption } from '../../shared/selector';
import { formatActivity } from '../../shared/i18n/format';
import { formatSize, formatTime, isSoundFont, type Draft, type ModelPackage, type Score, type State } from '../../shared/workbench';
import { noteCount, scoreDuration, scoreSeconds } from './score-draft';

const meters = [[4, 4], [3, 4], [2, 4], [6, 8], [12, 8]];

// 编曲检查器：渲染、音色库、速度拍号与段落时间。段落起止时间用于对照口播稿安排配乐。
export function ScoreInspector({ draft, state, catalog, change, generate, cancel, settings, close, header }: {
  draft: Draft; state: State; catalog: ModelPackage[]; change: (patch: Partial<Draft>) => void; header?: ReactNode;
  generate: () => void; cancel: () => void; settings: () => void; close: () => void;
}) {
  const t = useTranslator();
  const score = draft.score!;
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
  const fonts = catalog.filter(model => isSoundFont(model.id));
  const font = fonts.find(model => model.id === draft.modelId);
  const installed = state.models.some(model => model.id === draft.modelId);
  const update = (patch: Partial<Score>) => change({ score: { ...score, ...patch } });
  const empty = noteCount(score) === 0;
  return <VStack as="aside" className="inspector score-inspector" gap={0}>
    <VStack className="generation-action" gap={3}>
      {generating ? <Button label={t('@yovoice.create.cancelGenerate')} onClick={cancel} width="100%" />
        : <Button label={t('@yovoice.score.render')} variant="primary" width="100%" size="lg" aria-keyshortcuts="Control+Enter" isDisabled={busy || empty} onClick={generate} />}
      {generating ? <HStack className="generation-status" gap={2} vAlign="center">
        <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />
        <small className="grow" role="status">{state.activity ? formatActivity(t, state.activity) : ''}</small>
        <small className="generation-elapsed" aria-label={t('@yovoice.create.elapsed')}>{formatTime(elapsed)}</small>
      </HStack> : !installed && font ? <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap"><small className="grow">{t('@yovoice.score.soundFontRequired', { size: formatSize(font.size) })}</small><Button size="sm" label={t('@yovoice.score.downloadSoundFont')} onClick={settings} /></HStack>
        : <small>{t('@yovoice.score.renderHint')}</small>}
    </VStack>
    <VStack className="inspector-scroll" gap={5}>
      {header}
      <VStack className="inspector-actions" gap={3}>
        <HStack className="inspector-heading" hAlign="between" vAlign="center"><h2 className="inspector-section-title">{t('@yovoice.score.soundFont')}</h2><Button label={t('@yovoice.create.backToScript')} className="inspector-toggle" variant="secondary" onClick={close} /></HStack>
        <Selector label={t('@yovoice.score.soundFont')} isLabelHidden width="100%" className="model-selector" value={draft.modelId} isDisabled={busy}
          renderOption={item => <SelectorOption label={item.label} description={item.description} layout="inline" />} renderValue={item => item.label}
          options={[...fonts.map(model => ({ value: model.id, label: model.name, description: state.models.some(m => m.id === model.id) ? t('@yovoice.create.modelInstalled') : formatSize(model.size) })), { value: 'manage', label: t('@yovoice.create.manageModels') }]}
          onChange={modelId => { if (modelId === 'manage') settings(); else change({ modelId }); }} />
      </VStack>
      <VStack gap={3}>
        <h3>{t('@yovoice.score.rhythm')}</h3>
        <label className="number-field">{t('@yovoice.score.tempo')}<input type="number" min={30} max={300} step={1} value={score.tempo} onChange={event => { const tempo = Number(event.target.value); if (tempo >= 30 && tempo <= 300) update({ tempo }); }} /></label>
        <HStack className="number-field" gap={3} hAlign="between" vAlign="center"><small>{t('@yovoice.score.meter')}</small><Selector label={t('@yovoice.score.meter')} isLabelHidden size="sm" width="calc(var(--spacing-10) * 2)" value={score.timeSignature.join('/')} options={meters.map(m => ({ value: m.join('/'), label: m.join('/') }))} onChange={value => update({ timeSignature: value.split('/').map(Number) })} /></HStack>
        <TextInput label={t('@yovoice.score.key')} value={score.key ?? ''} placeholder={t('@yovoice.score.keyPlaceholder')} onChange={key => update({ key: key.slice(0, 40) })} />
        <small>{t('@yovoice.score.duration', { time: formatTime(scoreDuration(score)) })}</small>
      </VStack>
      <VStack gap={3}>
        <h3>{t('@yovoice.score.sections')}</h3>
        {score.sections?.length ? <VStack className="score-sections" gap={0} role="list" aria-label={t('@yovoice.score.sections')}>
          {score.sections.map(section => <HStack key={`${section.name}-${section.start}`} className="score-section-row" role="listitem" gap={3} hAlign="between" vAlign="center">
            <VStack gap={0}><b>{section.name}</b><small>{t('@yovoice.score.bars', { start: section.start, end: section.end })}{section.tempo ? ` · ${section.tempo} BPM` : ''}</small></VStack>
            <small className="score-section-time">{formatTime(scoreSeconds(score, section.start))}–{formatTime(scoreSeconds(score, section.end + 1))}</small>
          </HStack>)}
        </VStack> : <small>{t('@yovoice.score.noSections')}</small>}
      </VStack>
    </VStack>
  </VStack>;
}
