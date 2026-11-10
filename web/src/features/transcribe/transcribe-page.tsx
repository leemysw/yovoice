import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { Captions, Download, Mic, Square, Upload, X } from 'lucide-react';
import { call, transcribeSpeechFile, type TranscribeSelection } from '../../shared/lib/client';
import { formatActivity, formatCallError, formatDateTime } from '../../shared/i18n/format';
import { overflowTitle } from '../../shared/ui/overflow-title';
import { useElapsed } from '../../shared/lib/use-elapsed';
import { formatTime, transcribeSettings, type State } from '../../shared/workbench';
import { LibraryEmpty, LibraryPage, Ticket, TicketStamp } from '../library/library-layout';
import { WaveRing } from '../library/wave-ring';
import { micError, RecordingMeter, useRecorder } from '../media/recorder';
import { TranscriptEditor } from './transcript-editor';
import { TranscriptMenu } from './transcript-menu';
import { AudioTrackDialog } from './audio-track-dialog';

// 录音码率压低到 32 kbps，三小时的录音也只有约 40 MB；录音时长上限跟随设置里的转写时长上限。
const recordBitrate = 32000;

// 语音转写页：与作品库一样用票根列出保存的转写，上传音频或直接录音生成新的一份；
// 打开一份转写进入字幕编辑。录音与识别进度在列表上方原地显示，出错在页面里说明，不走全局通知。
export function TranscribePage({ state, openSettings }: { state: State; openSettings: () => void }) {
  const t = useTranslator();
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  const pending = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selection, setSelection] = useState<(TranscribeSelection & { name: string }) | null>(null);
  useEffect(() => () => {
    upload.current?.abort();
    if (pending.current) void discardUpload(pending.current);
  }, []);
  const settings = transcribeSettings(state.preferences);
  const recordLimit = settings.maxMinutes * 60;
  const recorder = useRecorder(recordLimit);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  // 正在转写的文件名，显示在进行中的票根上。
  const [pendingName, setPendingName] = useState('');
  // since 记下发起转写时活动的开始时间，只认这次转写的失败；known 是发起时已有的记录，新出现的那份自动打开。
  const [since, setSince] = useState<string | null | undefined>();
  const [known, setKnown] = useState<string[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const activity = state.activity;
  const working = activity?.status === 'running' && activity.task === 'transcribe';
  const failed = since !== undefined && activity?.task === 'transcribe' && activity.startedAt !== since && activity.status === 'failed' ? formatCallError(t, activity) : '';
  const busy = activity?.status === 'running';
  const transcripts = state.transcripts ?? [];
  const fresh = known ? transcripts.find(item => !known.includes(item.id)) : undefined;
  const opened = transcripts.find(item => item.id === (fresh?.id ?? openId));
  const needsModel = !state.models.some(m => m.id.startsWith('qwen3-asr-'));
  const fallbackName = t('@yovoice.transcribe.defaultName');
  const elapsed = useElapsed(working, activity?.startedAt);

  function watchTranscription(name: string) {
    setError('');
    setPendingName(name.replace(/\.[^.]+$/, ''));
    setSince(activity?.startedAt ?? null);
    setKnown(transcripts.map(item => item.id));
  }
  function resetWatch() {
    setSince(undefined);
    setKnown(null);
  }
  async function start(file?: File) {
    if (!file || upload.current || pending.current) return;
    const controller = new AbortController();
    upload.current = controller;
    setUploading(true);
    watchTranscription(file.name);
    try {
      const choice = await transcribeSpeechFile(file, settings.maxFileMB, controller.signal);
      if (choice) {
        if (controller.signal.aborted) {
          void discardUpload(choice.id);
          return;
        }
        resetWatch();
        pending.current = choice.id;
        setSelection({ ...choice, name: file.name });
      }
    } catch (e) {
      resetWatch();
      if (!controller.signal.aborted) setError(formatCallError(t, e));
    } finally {
      upload.current = null;
      setUploading(false);
    }
  }
  function cancelSelection() {
    if (pending.current) void discardUpload(pending.current);
    pending.current = null;
    setSelection(null);
  }
  async function selectTrack(track: number) {
    if (!selection || pending.current !== selection.id) return;
    pending.current = null;
    setSelection(null);
    setUploading(true);
    watchTranscription(selection.name);
    try { await call('speech.transcribe.select', { id: selection.id, name: selection.name, track }); }
    catch (e) { resetWatch(); setError(formatCallError(t, e)); }
    finally { setUploading(false); }
  }
  async function record() {
    setError('');
    try {
      await recorder.start(audio => {
        const ext = audio.type.includes('mp4') ? '.m4a' : audio.type.includes('ogg') ? '.ogg' : '.webm';
        // 名称会当作文件名处理，日期不能带斜杠。
        const now = new Date(), pad = (n: number) => String(n).padStart(2, '0');
        const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const name = t('@yovoice.transcribe.recordingName', { time });
        void start(new File([audio], name + ext, { type: audio.type }));
      }, { audioBitsPerSecond: recordBitrate });
    } catch (e) { setError(micError(t, e)); }
  }
  const open = (id: string | null) => { setKnown(null); setOpenId(id); };

  const fileInput = <input ref={input} hidden type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.webm,.mkv,.mp4,.mov" aria-label={t('@yovoice.transcribe.upload')}
    onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void start(file); }} />;
  if (opened) return <>{fileInput}<TranscriptEditor key={opened.id} transcript={opened} onBack={() => open(null)} /></>;

  // 正在录音或识别时不能再发起；其他任务占用推理时提示稍后。
  const blocked = busy || recorder.recording || uploading || !!selection;
  const blockedTip = busy && !working ? t('@yovoice.transcribe.busy') : undefined;
  const sources = (size: 'sm' | 'md') => needsModel
    ? <Button size={size} variant="primary" icon={<Download />} label={t('@yovoice.transcribe.openModels')} onClick={openSettings} />
    : <HStack gap={2} vAlign="center">
      <Button size={size} variant="secondary" icon={<Mic />} label={t('@yovoice.transcribe.record')} isDisabled={blocked} tooltip={blockedTip} onClick={() => void record()} />
      <Button size={size} variant="primary" icon={<Upload />} label={t('@yovoice.transcribe.upload')} isLoading={uploading} isDisabled={blocked} tooltip={blockedTip} onClick={() => input.current?.click()} />
      {uploading && upload.current ? <Button size={size} label={t('@yovoice.action.cancel')} onClick={() => upload.current?.abort()} /> : null}
    </HStack>;

  // 录音与识别进度：作为一张进行中的票根排在列表最前，标题栏与搜索框位置不变。
  // 录音时封面的麦克风随声音起伏，识别时封面声波环转动、进度条上有流光。
  const task = recorder.stream ? <Ticket key="task" className="transcribe-task" coverClassName="is-recording"
    cover={<WaveRing seed="recording" duration={30}><HStack className="empty-ring-mark" gap={0} hAlign="center" vAlign="center"><Mic /></HStack></WaveRing>}
    eyebrow={t('@yovoice.transcribe.recording')}
    title={<RecordingMeter stream={recorder.stream} limit={recordLimit} />}
    stubActions={<HStack gap={1}>
      <Button size="sm" variant="primary" isIconOnly icon={<Square />} label={t('@yovoice.transcribe.stopRecord')} onClick={recorder.stop} />
      <Button size="sm" variant="ghost" isIconOnly icon={<X />} label={t('@yovoice.transcribe.discardRecord')} onClick={recorder.cancel} />
    </HStack>} />
  : working ? <Ticket key="task" className="transcribe-task is-working" coverClassName="is-working"
    cover={<WaveRing seed={pendingName || 'transcribe'} duration={60}><HStack className="empty-ring-mark" gap={0} hAlign="center" vAlign="center"><Captions /></HStack></WaveRing>}
    eyebrow={<span role="status">{formatActivity(t, activity)}</span>}
    title={<VStack gap={2}><h3>{pendingName || fallbackName}</h3>
      <ProgressBar label={formatActivity(t, activity)} isLabelHidden value={activity.received} max={activity.total || 1} isIndeterminate={!activity.total} /></VStack>}
    stub={<TicketStamp value={formatTime(elapsed)} unit={t('@yovoice.create.elapsed')} />}
    stubActions={<Button size="sm" variant="ghost" isIconOnly icon={<X />} label={t('@yovoice.create.cancelGenerate')} onClick={() => void call('operation.cancel').catch(() => undefined)} />} />
  : null;
  const message = error || failed;
  // 出错提示放在已有的行里：有记录时在标题栏按钮左侧，空列表时在按钮下方预留的一行，不把列表往下推。
  const notice = <small role="alert" className="transcribe-note" title={message || undefined}>{message}</small>;

  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? transcripts.filter(item => `${item.name ?? ''}\n${item.excerpt ?? ''}`.toLocaleLowerCase().includes(needle)) : transcripts;
  return <VStack className="transcribe-page" gap={0} data-testid="transcribe-page">
    {fileInput}
    {selection ? <AudioTrackDialog key={selection.id} name={selection.name} tracks={selection.tracks} onCancel={cancelSelection} onSelect={track => void selectTrack(track)} /> : null}
    <LibraryPage title={t('@yovoice.transcribe.title')} actions={transcripts.length ? <HStack className="transcribe-actions" gap={3} vAlign="center">{message ? notice : null}{sources('sm')}</HStack> : undefined}
      query={query} onQueryChange={setQuery} searchLabel={t('@yovoice.transcribe.search')} noResults={t('@yovoice.library.noSearchResults')}
      hasItems={transcripts.length > 0 || !!task} hasSearch={transcripts.length > 0} hasResults={shown.length > 0 || !!task} layout="tickets"
      empty={<LibraryEmpty
        art={<WaveRing seed="empty-transcript" duration={30}><HStack className="empty-ring-mark" gap={0} hAlign="center" vAlign="center"><Captions /></HStack></WaveRing>}
        title={t('@yovoice.transcribe.emptyTitle')} description={t(needsModel ? '@yovoice.transcribe.needsModel' : '@yovoice.transcribe.emptyBody')}
        action={<VStack gap={3} hAlign="center">{sources('md')}{notice}</VStack>} />}>
      {task}
      {shown.map((item, index) => {
        const at = item.updatedAt ?? item.createdAt;
        const name = item.name || fallbackName;
        return <Ticket key={item.id} index={index} className="project-library-row transcribe-entry"
          cover={<WaveRing seed={item.id} duration={item.duration}><HStack className="empty-ring-mark" gap={0} hAlign="center" vAlign="center"><Captions /></HStack></WaveRing>}
          eyebrow={<time dateTime={at}>{formatDateTime(at, locale, 'log')}</time>} excerpt={item.excerpt}
          title={<Button variant="ghost" className="project-title" label={name} onPointerEnter={overflowTitle} onClick={() => open(item.id)} />}
          stub={<TicketStamp value={formatTime(item.duration)} unit={t('@yovoice.library.duration')} />}
          stubActions={<TranscriptMenu transcript={item} />} />;
      })}
    </LibraryPage>
  </VStack>;
}


function discardUpload(id: string) {
  return call('speech.transcribe.discard', { id }).catch(() => undefined);
}
