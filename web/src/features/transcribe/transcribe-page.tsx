import { useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { useTranslator } from '@astryxdesign/core/i18n';
import { Copy, FileAudio, Subtitles, Upload, X } from 'lucide-react';
import { call, transcribeSpeechFile } from '../../shared/lib/client';
import { formatActivity, formatCallError } from '../../shared/i18n/format';
import { formatTime, type State } from '../../shared/workbench';
import { srtTime, wordCaptions, type Caption } from '../media/caption-export';
import { saveCaptions, type CaptionFormat } from '../media/caption-dialog';

interface Row extends Record<string, unknown> { key: string; caption: Caption }

// 语音转写页：上传一段音频，用语音识别模型逐段识别出文字和逐词时间，按句分行后导出 SRT / WebVTT 字幕或复制全文。
// 结果只保留在本次会话，换一段音频或点“清除”后丢弃；出错在页面里说明，不走全局通知。
export function TranscribePage({ state, openSettings }: { state: State; openSettings: () => void }) {
  const t = useTranslator();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // since 记下发起转写时活动的开始时间，只认这次转写的失败。
  const [since, setSince] = useState<string | null | undefined>();
  const activity = state.activity;
  const working = activity?.status === 'running' && activity.task === 'transcribe';
  const failed = since !== undefined && activity?.task === 'transcribe' && activity.startedAt !== since && activity.status === 'failed' ? formatCallError(t, activity) : '';
  const busy = activity?.status === 'running';
  // 识别声音样本的结果属于参考文本输入框，这里只显示转写的结果。
  const result = state.transcript && !state.transcript.voiceId ? state.transcript : undefined;
  const captions = useMemo(() => result?.words?.length ? wordCaptions(result.text, result.words) : [], [result]);
  const name = result?.name || t('@yovoice.transcribe.defaultName');
  const needsModel = !state.models.some(m => m.id.startsWith('qwen3-asr-'));

  async function start(file?: File) {
    if (!file) return;
    setError(''); setNotice('');
    setSince(activity?.startedAt ?? null);
    try { await transcribeSpeechFile(file); }
    catch (e) { setSince(undefined); setError(formatCallError(t, e)); }
  }
  const exportAs = async (format: CaptionFormat) => {
    setError(''); setNotice('');
    try { if (await saveCaptions(captions, name, format)) setNotice(t('@yovoice.transcribe.saved')); }
    catch (e) { setError(formatCallError(t, e)); }
  };
  const copy = async () => {
    setError('');
    try { await navigator.clipboard.writeText(result?.text ?? ''); setNotice(t('@yovoice.transcribe.copied')); }
    catch (e) { setError(formatCallError(t, e)); }
  };

  const columns: TableColumn<Row>[] = [
    { key: 'time', header: t('@yovoice.transcribe.col.time'), width: pixel(200), renderCell: ({ caption: c }) => <small className="transcribe-time">{srtTime(c.start)} → {srtTime(c.end)}</small> },
    { key: 'text', header: t('@yovoice.transcribe.col.text'), width: proportional(1), renderCell: ({ caption: c }) => c.text },
  ];
  const rows: Row[] = captions.map((caption, i) => ({ key: String(i), caption }));
  const message = error || failed;

  return <VStack className="library-page transcribe-page" gap={5} data-testid="transcribe-page">
    <HStack className="library-heading" hAlign="between" vAlign="center" wrap="wrap" gap={3}>
      <h1>{t('@yovoice.transcribe.title')}</h1>
      <HStack gap={2} vAlign="center">
        {working ? <Button size="sm" label={t('@yovoice.create.cancelGenerate')} onClick={() => void call('operation.cancel').catch(() => undefined)} /> : null}
        <Button variant="primary" icon={<Upload />} label={t(result ? '@yovoice.transcribe.another' : '@yovoice.transcribe.upload')} isLoading={working} isDisabled={busy && !working}
          tooltip={busy && !working ? t('@yovoice.transcribe.busy') : undefined} onClick={() => input.current?.click()} />
      </HStack>
    </HStack>
    <input ref={input} hidden type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.webm,.mkv,.mp4,.mov" aria-label={t('@yovoice.transcribe.upload')}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void start(file); }} />
    {working ? <small role="status">{formatActivity(t, activity)}</small> : null}
    {message ? <HStack gap={2} vAlign="center" wrap="wrap"><small role="alert" className="dialog-error">{message}</small>
      {needsModel ? <Button size="sm" variant="secondary" label={t('@yovoice.transcribe.openModels')} onClick={openSettings} /> : null}</HStack> : null}
    {notice ? <small role="status">{notice}</small> : null}
    {result ? <VStack gap={3} className="transcribe-result">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <FileAudio size={16} aria-hidden />
        <strong className="grow transcribe-name">{name}</strong>
        <small>{t('@yovoice.transcribe.summary', { duration: formatTime(result.duration ?? 0), count: captions.length })}</small>
      </HStack>
      <HStack gap={2} wrap="wrap">
        <Button size="sm" icon={<Subtitles />} label={t('@yovoice.transcribe.exportSrt')} isDisabled={!captions.length} onClick={() => void exportAs('srt')} />
        <Button size="sm" variant="secondary" icon={<Subtitles />} label={t('@yovoice.transcribe.exportVtt')} isDisabled={!captions.length} onClick={() => void exportAs('vtt')} />
        <Button size="sm" variant="secondary" icon={<Copy />} label={t('@yovoice.transcribe.copy')} onClick={() => void copy()} />
        <Button size="sm" variant="ghost" icon={<X />} label={t('@yovoice.transcribe.clear')} onClick={() => { setNotice(''); void call('transcript.dismiss', { id: result.id }).catch(() => undefined); }} />
      </HStack>
      <VStack className="transcribe-table" gap={0}>
        <Table<Row> data={rows} columns={columns} idKey="key" density="compact" textOverflow="wrap" hasHover emptyState={<EmptyState title={t('@yovoice.transcribe.noCaptions')} />} />
      </VStack>
    </VStack> : working ? null : <EmptyState title={t('@yovoice.transcribe.emptyTitle')} description={t('@yovoice.transcribe.emptyBody')} />}
  </VStack>;
}
