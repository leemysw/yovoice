import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import definitions from '@internal/catalog/generation_options.json';
import { formatTime, type Draft, type Generation, type ModelPackage } from '../../shared/workbench';

type Edit = 'off' | 'init_audio' | 'inpaint_audio';
const spec = (key: string) => definitions.stable_audio.find(item => item.key === key);
const durationPresets = [10, 30, 60, 120, 180] as const;

/** Stable Audio 的选项值，缺省时取共享定义里的默认值。 */
export function stableAudioOptions(draft: Draft) {
  const values = draft.modelOptions?.stable_audio ?? {};
  const value = (key: string) => values[key] ?? spec(key)?.default ?? 0;
  return { values, edit: String(value('edit')) as Edit, duration: Number(value('duration_seconds')), value };
}

/** 作品里可作为改编起点的版本：同一作品、整段生成（不含逐句片段），新的在前。 */
export const sourceVersions = (draft: Draft, history: Generation[]) => history.filter(item => item.settings.id === draft.id && !item.segment).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// Stable Audio 的常用设置：时长，以及在已生成版本上改编（整体重写）或局部重绘某一段。
export function StableAudioControls({ draft, model, history, change, durationPresets: requestedPresets }: {
  draft: Draft; model?: ModelPackage; history: Generation[]; change: (patch: Partial<Draft>) => void; durationPresets?: readonly number[];
}) {
  const t = useTranslator();
  const locale = useLocale();
  const { values, edit, duration, value } = stableAudioOptions(draft);
  const limit = model?.maxDuration ?? 120;
  const update = (patch: Record<string, string | number>) => change({ modelOptions: { ...draft.modelOptions, stable_audio: { ...values, ...patch } } });
  const versions = sourceVersions(draft, history);
  const source = versions.some(item => item.id === draft.sourceGenerationId) ? draft.sourceGenerationId : undefined;
  const setEdit = (next: Edit) => {
    // 切到改编时默认选最新的版本；还没有重绘区间时先给开头 5 秒，便于直接试一次。
    const range: Record<string, number> = next === 'inpaint_audio' && Number(value('inpaint_end')) <= Number(value('inpaint_start')) ? { inpaint_start: 0, inpaint_end: Math.min(5, duration) } : {};
    const patch: Partial<Draft> = { modelOptions: { ...draft.modelOptions, stable_audio: { ...values, ...range, edit: next } } };
    if (next !== 'off' && !source && versions[0]) patch.sourceGenerationId = versions[0].id;
    change(patch);
  };
  const presets = (requestedPresets ?? durationPresets).filter(item => item <= limit);
  // 音效的短档位按秒显示（1 秒、3 秒），歌曲档位按分:秒显示。
  const seconds = new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'short' });
  const presetLabel = (item: number) => requestedPresets ? seconds.format(item) : formatTime(item);
  return <>
    <VStack gap={3}>
      <h3>{t('@yovoice.music.duration')}</h3>
      <SegmentedControl label={t('@yovoice.music.duration')} size="sm" layout="fill" value={presets.includes(duration as typeof presets[number]) ? String(duration) : ''} onChange={next => update({ duration_seconds: Number(next) })}>
        {presets.map(item => <SegmentedControlItem key={item} value={String(item)} label={presetLabel(item)} />)}
      </SegmentedControl>
    </VStack>
    <VStack gap={3}>
      <h3>{t('@yovoice.music.mode')}</h3>
      <SegmentedControl label={t('@yovoice.music.mode')} size="sm" layout="fill" value={edit} onChange={next => setEdit(next as Edit)}>
        <SegmentedControlItem value="off" label={t('@yovoice.music.editOff')} />
        <SegmentedControlItem value="init_audio" label={t('@yovoice.music.editInit')} />
        <SegmentedControlItem value="inpaint_audio" label={t('@yovoice.music.editInpaint')} />
      </SegmentedControl>
      {edit === 'off' ? null : versions.length === 0 ? <small>{t('@yovoice.music.sourceEmpty')}</small> : <>
        <Selector label={t('@yovoice.music.source')} value={source ?? ''} options={versions.map((item, index) => ({ value: item.id, label: `${t('@yovoice.app.historyVersion', { n: versions.length - index })} · ${formatTime(item.duration)}` }))} onChange={sourceGenerationId => change({ sourceGenerationId })} />
        {edit === 'init_audio' ? <label className="number-field">{t('@yovoice.music.editStrength')}
          <input type="number" min={0} max={1} step={0.05} value={Number(value('init_noise_level'))} onChange={event => { if (event.target.value !== '') update({ init_noise_level: Number(event.target.value) }); }} />
          <small>{t('@yovoice.music.editStrengthHint')}</small>
        </label> : <>
          <label className="number-field">{t('@yovoice.music.inpaintStart')}<input type="number" min={0} max={limit} step={0.1} value={Number(value('inpaint_start'))} onChange={event => { if (event.target.value !== '') update({ inpaint_start: Number(event.target.value) }); }} /></label>
          <label className="number-field">{t('@yovoice.music.inpaintEnd')}<input type="number" min={0} max={limit} step={0.1} value={Number(value('inpaint_end'))} onChange={event => { if (event.target.value !== '') update({ inpaint_end: Number(event.target.value) }); }} /></label>
        </>}
      </>}
    </VStack>
  </>;
}

/** 生成前能否提交：改编需要选中起点版本，重绘区间要有效。 */
export function stableAudioReady(draft: Draft, history: Generation[]) {
  const { edit, value } = stableAudioOptions(draft);
  if (edit === 'off') return true;
  if (!sourceVersions(draft, history).some(item => item.id === draft.sourceGenerationId)) return false;
  return edit === 'init_audio' || Number(value('inpaint_end')) > Number(value('inpaint_start'));
}
