import { useState, type RefObject } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Selector } from '../../shared/selector';
import { AppDialog } from '../../shared/ui/app-dialog';
import { formatNotice } from '../../shared/i18n/format';
import { encodeWav } from '../../shared/lib/sound';
import { isDesktop, saveAudio, type AudioExportFormat } from '../../shared/lib/client';
import { noticeMessage } from '../../shared/lib/call-error';
import { readLocal, writeLocal } from '../../shared/lib/local-store';
import type { AudioTimeline, Draft, Generation } from '../../shared/workbench';
import { Timeline } from './timeline';
import { timelineCaptions } from './caption-export';
import { saveCaptions } from './caption-dialog';

// 导出格式：音频（WAV，桌面端另有 FLAC / M4A），或按片段实际位置生成的 SRT / WebVTT 字幕。
type ExportFormat = AudioExportFormat | 'srt' | 'vtt';
const isAudio = (format: ExportFormat): format is AudioExportFormat => format === 'wav' || format === 'flac' || format === 'm4a';
// 对话框关闭后仍保留的导出偏好。
type ExportPrefs = { format: ExportFormat; captionSpeaker: boolean; preventClipping: boolean; loudness: string; balance: boolean };

type ExportDialogProps = {
  value: AudioTimeline; history: Generation[]; draft: Draft; range?: { start: number; end: number };
  context: RefObject<AudioContext | null>; load: (id: string, audio: AudioContext) => Promise<AudioBuffer>;
  exporting: boolean; setExporting: (exporting: boolean) => void; onClose: () => void;
};

// 导出对话框常驻挂载以记住偏好：格式、说话人、防削波、统一角色音量与目标响度关闭后保留；名称、范围、错误与峰值随每次打开重置。
export function TimelineExportDialog({ open, ...props }: ExportDialogProps & { open: boolean }) {
  // 目标响度（LUFS）由本地服务整体调整，记住上次的选择；浏览器预览不调整。
  const [prefs, setPrefs] = useState<ExportPrefs>(() => { const value = readLocal('yovoice.exportLoudness') ?? ''; return { format: 'wav', captionSpeaker: false, preventClipping: true, balance: readLocal('yovoice.exportBalance') === 'on', loudness: isDesktop && ['-18', '-16', '-14'].includes(value) ? value : '' }; });
  const update = (patch: Partial<ExportPrefs>) => setPrefs(current => ({ ...current, ...patch }));
  return open ? <ExportDialog {...props} prefs={prefs} update={update} /> : null;
}

function ExportDialog({ value, history, draft, range, context, load, exporting, setExporting, onClose, prefs, update }: ExportDialogProps & { prefs: ExportPrefs; update: (patch: Partial<ExportPrefs>) => void }) {
  const t = useTranslator();
  const { format, captionSpeaker, preventClipping, loudness, balance } = prefs;
  // 两个以上角色才需要统一音量；只调整这次导出的混音，不改时间线。
  const roles = (draft.subtitles?.speakers.length ?? 0) > 1;
  const [scope, setScope] = useState('all');
  const [name, setName] = useState(draft.title);
  const [error, setError] = useState('');
  const [peakDb, setPeakDb] = useState<number>();
  const run = async () => {
    setExporting(true); setError('');
    try {
      let snapshot = Timeline.scoped(structuredClone(value), scope, history);
      if (!isAudio(format)) {
        const captions = timelineCaptions(snapshot, history, draft.subtitles?.speakers, scope === 'range' ? range : undefined);
        if (!captions.length) { setError('@yovoice.timeline.noCaptions'); return; }
        if (await saveCaptions(captions, name, format, captionSpeaker)) onClose();
        return;
      }
      const audio = context.current ??= new AudioContext();
      if (roles && balance) {
        const buffers = new Map<string, AudioBuffer>();
        for (const key of new Set(snapshot.tracks.flatMap(t => t.clips.map(c => Timeline.sourceKey(c))))) buffers.set(key, await load(key, audio));
        snapshot = Timeline.balance(snapshot, history, buffers);
      }
      const result = await Timeline.render(snapshot, id => load(id, audio), scope === 'range' ? range : undefined);
      const peak = Timeline.peak(result); setPeakDb(peak ? 20 * Math.log10(peak) : -Infinity);
      // 选了目标响度时先压到满幅以内再交给本地服务调整，避免 16 位编码时先削掉峰值。
      if (peak > 1 && (preventClipping || loudness)) for (let channel = 0; channel < result.numberOfChannels; channel++) { const samples = result.getChannelData(channel); for (let i = 0; i < samples.length; i++) samples[i] *= 0.99 / peak; }
      if (peak > 1 && !preventClipping && !loudness && peakDb === undefined) { setError(t('@yovoice.timeline.clipping')); return; }
      if (await saveAudio(encodeWav(result), name, loudness ? Number(loudness) : undefined, format)) onClose();
    } catch (error) { setError(noticeMessage(error)); } finally { setExporting(false); }
  };
  return <AppDialog title={t('@yovoice.timeline.export')} busy={exporting} error={formatNotice(t, error)} onClose={onClose} actions={<Button label={t(isAudio(format) ? '@yovoice.timeline.exportConfirm' : '@yovoice.timeline.exportCaptions')} variant="primary" isLoading={exporting} isDisabled={!name.trim()} onClick={() => void run()} />}>
    <TextInput label={t('@yovoice.timeline.exportName')} value={name} onChange={setName} />
    <Selector label={t('@yovoice.timeline.exportType')} value={format} onChange={v => { update({ format: v as ExportFormat }); setError(''); setPeakDb(undefined); }} options={[{ value: 'wav', label: t('@yovoice.timeline.formatWav') }, ...(isDesktop ? [{ value: 'flac', label: t('@yovoice.export.formatFlac') }, { value: 'm4a', label: t('@yovoice.export.formatM4a') }] : []), { value: 'srt', label: t('@yovoice.timeline.formatSrt') }, { value: 'vtt', label: t('@yovoice.timeline.formatVtt') }]} />
    <Selector label={t('@yovoice.timeline.exportScope')} value={scope} onChange={v => { setScope(v); setError(''); setPeakDb(undefined); }} options={[{ value: 'all', label: t('@yovoice.timeline.all') }, ...(range ? [{ value: 'range', label: t('@yovoice.timeline.range') }] : []), ...value.tracks.map(t => ({ value: `track:${t.id}`, label: t.name })), ...(draft.subtitles?.speakers ?? []).map((s, i) => ({ value: `role:${s.id}`, label: s.sourceName || t('@yovoice.subtitle.speaker', { n: i + 1 }) }))]} />
    {isAudio(format) ? <>
      {isDesktop ? <Selector label={t('@yovoice.timeline.loudness')} value={loudness} onChange={value => { update({ loudness: value }); writeLocal('yovoice.exportLoudness', value); setError(''); setPeakDb(undefined); }} description={loudness ? t('@yovoice.timeline.loudnessHint') : undefined}
        options={[{ value: '', label: t('@yovoice.timeline.loudnessOff') }, { value: '-18', label: t('@yovoice.timeline.loudnessAudiobook') }, { value: '-16', label: t('@yovoice.timeline.loudnessPodcast') }, { value: '-14', label: t('@yovoice.timeline.loudnessVideo') }]} /> : null}
      {roles ? <CheckboxInput label={t('@yovoice.timeline.exportBalance')} description={t('@yovoice.timeline.exportBalanceHint')} value={balance} onChange={checked => { update({ balance: checked }); writeLocal('yovoice.exportBalance', checked ? 'on' : ''); setPeakDb(undefined); }} /> : null}
      {loudness ? null : <CheckboxInput label={t('@yovoice.timeline.preventClipping')} value={preventClipping} onChange={checked => { update({ preventClipping: checked }); setPeakDb(undefined); }} />}
      {peakDb !== undefined ? <small>{t('@yovoice.timeline.peak')}: {Number.isFinite(peakDb) ? peakDb.toFixed(1) : '−∞'} dBFS</small> : null}
    </> : <>
      <CheckboxInput label={t('@yovoice.timeline.captionSpeaker')} value={captionSpeaker} onChange={checked => update({ captionSpeaker: checked })} />
      <small>{t('@yovoice.timeline.captionHint')}</small>
    </>}
  </AppDialog>;
}
