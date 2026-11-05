import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import { AppDialog } from '../../shared/ui/app-dialog';
import { formatNotice } from '../../shared/i18n/format';
import { exportOutput, type AudioExportFormat, type AudioExportTags } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { readLocal, writeLocal } from '../../shared/lib/local-store';
import type { Generation } from '../../shared/workbench';

const formats: AudioExportFormat[] = ['wav', 'flac', 'm4a'];

// 导出一个已生成的版本（桌面端）：选格式与目标响度，记住上次的选择；
// FLAC / M4A 可写入标题、歌词与封面，tags 由调用方按作品类型给出，导出时才生成（封面要画一张图）。
export function VersionExportDialog({ generation, name: initialName, tags, onClose }: { generation: Generation; name: string; tags?: () => AudioExportTags; onClose: () => void }) {
  const t = useTranslator();
  const [name, setName] = useState(initialName);
  const [format, setFormat] = useState<AudioExportFormat>(() => { const value = readLocal('yovoice.exportFormat'); return formats.includes(value as AudioExportFormat) ? value as AudioExportFormat : 'wav'; });
  const [loudness, setLoudness] = useState(() => { const value = readLocal('yovoice.exportLoudness') ?? ''; return ['-18', '-16', '-14'].includes(value) ? value : ''; });
  const [withTags, setWithTags] = useState(() => readLocal('yovoice.exportTags') !== 'off');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try {
      if (await exportOutput(generation.id, generation.fileName, name, { format, loudness: loudness ? Number(loudness) : undefined, tags: format !== 'wav' && withTags && tags ? tags() : undefined })) onClose();
    } catch (e) { setError(noticeMessage(e)); } finally { setBusy(false); }
  };
  return <AppDialog title={t('@yovoice.app.exportVersion')} busy={busy} error={formatNotice(t, error)} onClose={onClose} actions={<Button label={t('@yovoice.timeline.exportConfirm')} variant="primary" isLoading={busy} isDisabled={!name.trim()} onClick={() => void run()} />}>
    <TextInput label={t('@yovoice.timeline.exportName')} value={name} onChange={setName} />
    <Selector label={t('@yovoice.export.format')} value={format} onChange={value => { setFormat(value as AudioExportFormat); writeLocal('yovoice.exportFormat', value); setError(''); }}
      description={format === 'flac' ? t('@yovoice.export.formatFlacHint') : format === 'm4a' ? t('@yovoice.export.formatM4aHint') : undefined}
      options={[{ value: 'wav', label: t('@yovoice.timeline.formatWav') }, { value: 'flac', label: t('@yovoice.export.formatFlac') }, { value: 'm4a', label: t('@yovoice.export.formatM4a') }]} />
    <Selector label={t('@yovoice.timeline.loudness')} value={loudness} onChange={value => { setLoudness(value); writeLocal('yovoice.exportLoudness', value); setError(''); }} description={loudness ? t('@yovoice.timeline.loudnessHint') : undefined}
      options={[{ value: '', label: t('@yovoice.timeline.loudnessOff') }, { value: '-18', label: t('@yovoice.timeline.loudnessAudiobook') }, { value: '-16', label: t('@yovoice.timeline.loudnessPodcast') }, { value: '-14', label: t('@yovoice.timeline.loudnessVideo') }]} />
    {format !== 'wav' && tags ? <label><input type="checkbox" checked={withTags} onChange={e => { setWithTags(e.target.checked); writeLocal('yovoice.exportTags', e.target.checked ? 'on' : 'off'); }} /> {t('@yovoice.export.tags')}</label> : null}
  </AppDialog>;
}
