import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { LoaderCircle } from 'lucide-react';
import { Selector } from '../../shared/selector';
import { formatActivity } from '../../shared/i18n/format';
import { formatBytes, formatTime, isSoundFont, type Draft, type ModelPackage, type Score, type State } from '../../shared/workbench';
import { ModelSelector } from '../create/model-selector';
import { emptyScore, noteCount, scoreDuration } from './score-draft';
import { useElapsed } from '../../shared/lib/use-elapsed';

const meters = [[4, 4], [3, 4], [2, 4], [6, 8], [12, 8]];

// 编曲检查器只放设置：渲染、音色库、速度拍号与调性；段落显示在轨道区的标尺上。
export function ScoreInspector({ draft, state, catalog, change, generate, cancel, settings, header }: {
  draft: Draft; state: State; catalog: ModelPackage[]; change: (patch: Partial<Draft>) => void; header?: ReactNode;
  generate: () => void; cancel: () => void; settings: () => void; close?: () => void;
}) {
  const t = useTranslator();
  const score = draft.score ?? emptyScore();
  const busy = state.activity?.status === 'running';
  const generating = busy && state.activity?.kind === 'generate' && state.activity.projectId === draft.id;
  const elapsed = useElapsed(generating, state.activity?.startedAt);
  const fonts = catalog.filter(model => isSoundFont(model.id));
  const font = fonts.find(model => model.id === draft.modelId);
  const installed = state.models.some(model => model.id === draft.modelId);
  const update = (patch: Partial<Score>) => change({ score: { ...score, ...patch } });
  const empty = noteCount(score) === 0;
  return <VStack as="aside" className="inspector score-inspector" gap={0}>
    <VStack className="generation-action" gap={3}>
      {generating ? <Button label={t('@yovoice.create.cancelGenerate')} onClick={cancel} width="100%" />
        : <Button label={t('@yovoice.score.render')} variant="primary" width="100%" aria-keyshortcuts="Control+Enter" isDisabled={busy || empty} onClick={generate} />}
      {generating ? <HStack className="generation-status" gap={2} vAlign="center">
        <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />
        <small className="grow" role="status">{state.activity ? formatActivity(t, state.activity) : ''}</small>
        <small className="generation-elapsed" aria-label={t('@yovoice.create.elapsed')}>{formatTime(elapsed)}</small>
      </HStack> : !installed && font ? <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap"><small className="grow">{t('@yovoice.score.soundFontRequired', { size: formatBytes(font.size) })}</small><Button size="sm" label={t('@yovoice.score.downloadSoundFont')} onClick={settings} /></HStack>
        : null}
    </VStack>
    <VStack className="inspector-scroll" gap={5}>
      {header}
      <VStack className="inspector-actions" gap={3}>
        <h2 className="inspector-section-title">{t('@yovoice.score.soundFont')}</h2>
        <ModelSelector label={t('@yovoice.score.soundFont')} models={fonts} state={state} value={draft.modelId} isDisabled={generating} manage={settings} name={model => model.name} onChange={modelId => change({ modelId })} />
      </VStack>
      <VStack gap={3}>
        <h3>{t('@yovoice.score.rhythm')}</h3>
        <label className="number-field">{t('@yovoice.score.tempo')}<input type="number" min={30} max={300} step={1} value={score.tempo} onChange={event => { const tempo = Number(event.target.value); if (tempo >= 30 && tempo <= 300) update({ tempo }); }} /></label>
        <HStack className="number-field" gap={3} hAlign="between" vAlign="center"><small>{t('@yovoice.score.meter')}</small><Selector label={t('@yovoice.score.meter')} isLabelHidden size="sm" width="calc(var(--spacing-10) * 2)" value={score.timeSignature.join('/')} options={meters.map(m => ({ value: m.join('/'), label: m.join('/') }))} onChange={value => update({ timeSignature: value.split('/').map(Number) })} /></HStack>
        <TextInput label={t('@yovoice.score.key')} value={score.key ?? ''} placeholder={t('@yovoice.score.keyPlaceholder')} onChange={key => update({ key: key.slice(0, 40) })} />
        <small>{t('@yovoice.score.duration', { time: formatTime(scoreDuration(score)) })}</small>
      </VStack>
    </VStack>
  </VStack>;
}
