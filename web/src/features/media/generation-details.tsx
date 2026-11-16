import { Button } from '@astryxdesign/core/Button';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import catalog from '@internal/catalog/catalog.json';
import { AppDialog } from '../../shared/ui/app-dialog';
import { download, exportName } from '../../shared/lib/client';
import { formatDateTime } from '../../shared/i18n/format';
import { formatTime, type Generation } from '../../shared/workbench';

export function generationModelLabel(item: Generation) {
  const model = catalog.models.find(model => model.id === item.settings.modelId);
  return model ? `${model.name} · ${model.precision}` : item.settings.modelId || '—';
}

// 只读生成记录的配置快照，不拿当前草稿、角色或模型默认值补齐历史。
export function GenerationDetails({ item, close }: { item: Generation; close: () => void }) {
  const t = useTranslator();
  const locale = useLocale();
  const labels: Record<string, string> = {
    'runtime.streaming': '@yovoice.runtime.streaming',
    mode: '@yovoice.create.expression', inferEmotion: '@yovoice.create.inferEmotion', emotionStrength: '@yovoice.create.emotionStrength',
    randomEmotion: '@yovoice.create.randomEmotion', emotions: '@yovoice.create.mode.vector',
    speaker: '@yovoice.reference.speaker', voiceId: '@yovoice.create.referenceVoice', emotionVoiceId: '@yovoice.create.mode.reference',
    voiceDescription: item.settings.modelId.includes('customvoice') ? '@yovoice.vox.styleGuidance' : '@yovoice.vox.voiceDescription',
    referenceText: '@yovoice.vox.referenceText', synthesisLanguage: '@yovoice.create.language', language: '@yovoice.create.language',
    speed: '@yovoice.create.speed', temperature: '@yovoice.create.temperature', topP: '@yovoice.options.top_p', topK: '@yovoice.options.top_k',
    repetitionPenalty: '@yovoice.create.repetitionPenalty', maxTokens: '@yovoice.create.maxTokens', intervalSilenceMs: '@yovoice.create.intervalSilence',
    doSample: '@yovoice.create.doSample', numBeams: '@yovoice.create.numBeams', lengthPenalty: '@yovoice.create.lengthPenalty',
    emotionText: '@yovoice.create.emotionDescription', voiceMode: '@yovoice.vox.generationMode', voxMode: '@yovoice.vox.generationMode',
    inferenceSteps: '@yovoice.vox.inferenceSteps', guidanceScale: '@yovoice.vox.guidanceScale',
  };
  const excluded = new Set(['id', 'title', 'text', 'modelId', 'seed', 'createdAt', 'updatedAt', 'timeline', 'score', 'subtitles', 'lyrics', 'abc']);
  const rows = (value: unknown, path = ''): { key: string; label: string; value: string }[] => {
    if (value === null || value === undefined || value === '') return [];
    if (typeof value === 'object' && !Array.isArray(value)) return Object.entries(value).flatMap(([key, value]) => !path && excluded.has(key) ? [] : rows(value, path ? `${path}.${key}` : key));
    const key = path.split('.').at(-1)!;
    const label = path.startsWith('modelOptions.') ? `${path.split('.')[1]} · ${t(`@yovoice.options.${key}`)}` : labels[path] ? t(labels[path]) : path;
    const display = path === 'mode' ? t(`@yovoice.create.mode.${value}`) : ['voiceMode', 'voxMode'].includes(path) ? t(`@yovoice.vox.${value}`) : String(value);
    return [{ key: path, label, value: typeof value === 'boolean' ? t(value ? '@yovoice.history.enabled' : '@yovoice.history.disabled') : Array.isArray(value) ? value.join(', ') : display }];
  };
  return <AppDialog title={t('@yovoice.history.configuration')} subtitle={item.title} width={640} onClose={close} actions={<Button label={t('@yovoice.history.exportConfiguration')} onClick={() => download(new Blob([JSON.stringify({ generationId: item.id, createdAt: item.createdAt, duration: item.duration, seed: item.seed, settings: item.settings }, null, 2)], { type: 'application/json' }), `${exportName(item.title)}.json`)} />}>
    <MetadataList columns={2} label={{ position: 'top' }}>
      <MetadataListItem label={t('@yovoice.create.model')}>{generationModelLabel(item)}</MetadataListItem>
      <MetadataListItem label={t('@yovoice.history.generatedAt')}>{item.createdAt ? formatDateTime(item.createdAt, locale) : '—'}</MetadataListItem>
      <MetadataListItem label={t('@yovoice.library.duration')}>{formatTime(item.duration)}</MetadataListItem>
      <MetadataListItem label={t('@yovoice.create.seed')}>{item.seed ?? item.settings.seed ?? '—'}</MetadataListItem>
    </MetadataList>
    {item.settings.text !== undefined ? <TextArea label={t('@yovoice.history.generationText')} value={item.settings.text} isReadOnly rows={4} /> : null}
    {item.settings.lyrics ? <TextArea label={t('@yovoice.music.lyrics')} value={item.settings.lyrics} isReadOnly rows={4} /> : null}
    {item.settings.abc ? <TextArea label="ABC" value={item.settings.abc} isReadOnly rows={4} /> : null}
    <p className="helper">{t('@yovoice.history.snapshotHelp')}</p>
    <MetadataList title={t('@yovoice.history.savedParameters')} maxNumOfItems={12}>
      {rows(item.settings).map(row => <MetadataListItem key={row.key} label={row.label}>{row.value}</MetadataListItem>)}
    </MetadataList>
  </AppDialog>;
}
