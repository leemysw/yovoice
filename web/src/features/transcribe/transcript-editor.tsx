import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useTranslator } from '@astryxdesign/core/i18n';
import { ArrowLeft, Copy, Download, Merge, Play, Replace, Scissors, Search, Square, Trash2, Undo2 } from 'lucide-react';
import { call, mediaUrl, releaseMediaUrl } from '../../shared/lib/client';
import { formatCallError } from '../../shared/i18n/format';
import { formatTime, type AlignedWord, type Transcript, type TranscriptCaption, type TranscriptContent } from '../../shared/workbench';
import { CueText } from '../create/subtitles';
import { srtTime, wordCaptions } from '../media/caption-export';
import { saveCaptions, type CaptionFormat } from '../media/caption-dialog';
import { editText, findRows, joinText, mergeNext, removeAt, replaceAll, splitAt } from './caption-edit';
import { TranscriptMenu } from './transcript-menu';

// 每页显示的字幕行数：长录音有上千行，整页渲染输入框会拖慢输入。
const pageSize = 50;
// 停止输入后多久自动保存；撤销最多记录的步数；每行最多字数与后端一致。
const saveDelay = 800, undoLimit = 100, lineLimit = 1000;

// 行首的时间：不到一小时省去小时。
const clock = (seconds: number) => srtTime(seconds).replace(/^00:/, '').replace(',', '.');

// 一份转写的字幕编辑，与故事的字幕编辑手感一致：每行是一段可直接改的文字，回车在光标处拆分，
// 行首退格与上一行合并，空行退格删除；悬停一行显示拆分、合并和删除。改动自动保存，可撤销。
// 有原音频时点行首时间试听这一行。导出 SRT / WebVTT 用编辑后的字幕。
// lines 是设置里的断句参数，还没编辑过的转写按它把逐词时间分成字幕行。
export function TranscriptEditor({ transcript, lines, onBack }: { transcript: Transcript; lines: { lineChars: number; lineSeconds: number; linePause: number }; onBack: () => void }) {
  const t = useTranslator();
  const [content, setContent] = useState<TranscriptContent | null>(null);
  const [captions, setCaptions] = useState<TranscriptCaption[]>([]);
  const [undo, setUndo] = useState<TranscriptCaption[][]>([]);
  const lastEdit = useRef('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [page, setPage] = useState(1);
  const [searching, setSearching] = useState(false);
  const [find, setFind] = useState('');
  const [replacement, setReplacement] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const name = transcript.name || t('@yovoice.transcribe.defaultName');
  // 断句参数取打开时的值，之后改设置不会打断正在编辑的字幕。
  const [lineRules] = useState(lines);

  // 读取字幕文件；还没编辑过时按逐词时间分行。
  useEffect(() => {
    let cancelled = false;
    call<TranscriptContent>('transcript.read', { id: transcript.id }).then(loaded => {
      if (cancelled) return;
      setContent(loaded);
      setCaptions(loaded.captions ?? (loaded.words.length ? wordCaptions(loaded.text, loaded.words, { maxWidth: lineRules.lineChars, maxSeconds: lineRules.lineSeconds, pause: lineRules.linePause }) : []));
    }).catch(e => { if (!cancelled) setError(formatCallError(t, e)); });
    return () => { cancelled = true; };
  }, [transcript.id, t, lineRules]);

  // 自动保存：改动后停顿 saveDelay 再写入；离开页面或切换转写时立即写入还没保存的改动。
  const pending = useRef<TranscriptCaption[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  async function flush() {
    clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSaving('saving');
    try { await call('transcript.save', { id: transcript.id, captions: next }); setSaving(state => state === 'saving' ? 'saved' : state); }
    catch (e) { setSaving('idle'); setError(formatCallError(t, e)); }
  }
  useEffect(() => {
    const id = transcript.id, saved = pending, wait = timer;
    return () => {
      clearTimeout(wait.current);
      const next = saved.current;
      saved.current = null;
      if (next) void call('transcript.save', { id, captions: next }).catch(() => undefined);
    };
  }, [transcript.id]);
  const schedule = (next: TranscriptCaption[]) => {
    pending.current = next; setSaving('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), saveDelay);
  };

  function change(next: TranscriptCaption[], kind: string) {
    if (next === captions) return;
    // 连续输入同一行只记一步撤销，其他操作各记一步。
    if (kind !== lastEdit.current || !kind.startsWith('text:')) setUndo(stack => [...stack.slice(-(undoLimit - 1)), captions]);
    lastEdit.current = kind;
    setCaptions(next); setError(''); setNotice('');
    schedule(next);
  }
  function revert() {
    const previous = undo.at(-1);
    if (!previous) return;
    setUndo(stack => stack.slice(0, -1)); lastEdit.current = '';
    setCaptions(previous); setNotice('');
    schedule(previous);
  }

  const words: AlignedWord[] = content?.words ?? [];
  const filter = searching ? find : '';
  const matches = useMemo(() => findRows(captions, filter), [captions, filter]);
  const shown = filter ? matches : captions.map((_, i) => i);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages);
  const rows = shown.slice((current - 1) * pageSize, current * pageSize);

  // 拆分、合并或删除后把光标放到对应行：position 为空时放到行尾。
  const pendingFocus = useRef<{ index: number; position?: number } | null>(null);
  const field = (index: number) => list.current?.querySelector<HTMLTextAreaElement>(`[data-line="${index}"] textarea`);
  const focusLine = (index: number, position?: number) => {
    pendingFocus.current = { index, position };
    if (!filter) setPage(Math.floor(index / pageSize) + 1);
  };
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const element = field(target.index);
    if (!element) return;
    element.focus();
    const position = target.position ?? element.value.length;
    element.setSelectionRange(position, position);
  }, [captions, current]);

  function split(index: number, at: number) {
    const next = splitAt(captions, index, at, words);
    if (!next) { setNotice(t('@yovoice.transcribe.splitHint')); return; }
    change(next, 'split');
    focusLine(index + 1, 0);
  }
  function join(index: number) {
    if (index < 1) return;
    const position = joinText(captions[index - 1].text, captions[index].text).length - captions[index].text.trim().length;
    change(mergeNext(captions, index - 1), 'merge');
    focusLine(index - 1, position);
  }
  function remove(index: number, backward: boolean) {
    change(removeAt(captions, index), 'delete');
    if (captions.length > 1) focusLine(backward ? Math.max(0, index - 1) : Math.min(index, captions.length - 2), backward ? undefined : 0);
  }
  function replace() {
    const result = replaceAll(captions, find, replacement);
    if (!result.count) { setNotice(t('@yovoice.transcribe.noMatch')); return; }
    change(result.captions, 'replace');
    setNotice(t('@yovoice.transcribe.replaced', { count: result.count }));
  }

  // 试听：从这一行的开始播到结束；再点一次停止。
  const audio = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [playing, setPlaying] = useState<number | null>(null);
  const stopAt = useRef(0);
  useEffect(() => {
    if (!transcript.audioFile) return;
    let url = '', cancelled = false;
    void mediaUrl('outputs', transcript.audioFile).then(value => { url = value; if (cancelled) releaseMediaUrl(value); else setAudioUrl(value); }).catch(() => undefined);
    return () => { cancelled = true; releaseMediaUrl(url); };
  }, [transcript.audioFile]);
  function audition(index: number) {
    const element = audio.current;
    if (!element) return;
    if (playing === index) { element.pause(); return; }
    stopAt.current = captions[index].end;
    element.currentTime = captions[index].start;
    setPlaying(index);
    void element.play().catch(() => { setPlaying(null); setError(t('@yovoice.error.audioPlayFailed')); });
  }

  const exportAs = async (format: CaptionFormat) => {
    setError(''); setNotice('');
    try { if (await saveCaptions(captions.filter(c => c.text.trim()), name, format)) setNotice(t('@yovoice.transcribe.saved')); }
    catch (e) { setError(formatCallError(t, e)); }
  };
  const copy = async () => {
    setError('');
    try { await navigator.clipboard.writeText(captions.map(c => c.text.trim()).filter(Boolean).join('\n')); setNotice(t('@yovoice.transcribe.copied')); }
    catch (e) { setError(formatCallError(t, e)); }
  };
  // 提示几秒后自动消失，回到保存状态。
  useEffect(() => {
    if (!notice) return;
    const wait = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(wait);
  }, [notice]);
  const status = saving === 'saving' || saving === 'pending' ? t('@yovoice.transcribe.saving') : saving === 'saved' ? t('@yovoice.transcribe.autosaved') : '';
  // 出错、操作提示和保存状态共用元信息行的同一位置，不另起一行，免得字幕上下跳动。
  const message = error || notice || status;
  const empty = !content ? t('@yovoice.transcribe.loading') : filter ? t('@yovoice.transcribe.noMatch') : t('@yovoice.transcribe.noCaptions');

  return <VStack gap={4} className="library-page transcribe-editor" data-testid="transcript-editor">
    {transcript.audioFile ? <audio hidden ref={audio} src={audioUrl || undefined} preload="metadata"
      onTimeUpdate={event => { if (playing !== null && event.currentTarget.currentTime >= stopAt.current) event.currentTarget.pause(); }}
      onPause={() => setPlaying(null)} onEnded={() => setPlaying(null)} /> : null}
    <HStack className="library-heading transcribe-heading" hAlign="between" vAlign="center" gap={3}>
      <HStack className="grow transcribe-title" gap={2} vAlign="center">
        <Button size="sm" variant="ghost" isIconOnly icon={<ArrowLeft />} label={t('@yovoice.transcribe.back')} onClick={() => { void flush(); onBack(); }} />
        <h1>{name}</h1>
      </HStack>
      <HStack gap={1} vAlign="center">
        <Button size="sm" variant="ghost" isIconOnly icon={<Undo2 />} label={t('@yovoice.transcribe.undo')} isDisabled={!undo.length} onClick={revert} />
        <Button size="sm" variant="ghost" isIconOnly icon={<Search />} label={t('@yovoice.transcribe.findToggle')} aria-pressed={searching}
          onClick={() => { setSearching(!searching); setPage(1); setNotice(''); }} />
        <DropdownMenu presentation="popover" alignment="end" hasChevron={false}
          button={{ label: t('@yovoice.transcribe.exportMenu'), icon: <Download />, size: 'sm', variant: 'primary', isDisabled: !captions.length }}
          items={[
            { id: 'srt', label: t('@yovoice.transcribe.exportSrt'), onClick: () => void exportAs('srt') },
            { id: 'vtt', label: t('@yovoice.transcribe.exportVtt'), onClick: () => void exportAs('vtt') },
          ]} />
        {/* 删除前丢掉还没保存的改动，免得写回已删除的记录。 */}
        <TranscriptMenu transcript={transcript} onDeleted={onBack} beforeDelete={() => { clearTimeout(timer.current); pending.current = null; }}
          extra={[{ id: 'copy', label: t('@yovoice.transcribe.copy'), icon: <Copy className="project-menu-icon" strokeWidth={1.5} />, isDisabled: !captions.length, onClick: () => void copy() }]} />
      </HStack>
    </HStack>
    <HStack className="transcribe-meta" gap={3} vAlign="center">
      <small className="transcribe-summary">{t('@yovoice.transcribe.summary', { duration: formatTime(transcript.duration), count: captions.length })}</small>
      {message ? <small className="transcribe-message" role={error ? 'alert' : 'status'} data-tone={error ? 'danger' : undefined} title={message}>{message}</small> : null}
      <small className="grow transcribe-hint">{t('@yovoice.transcribe.editHint')}</small>
    </HStack>
    {searching ? <HStack className="transcribe-find" gap={2} vAlign="center" wrap="wrap">
      <TextInput label={t('@yovoice.transcribe.find')} isLabelHidden size="sm" startIcon={<Search />} placeholder={t('@yovoice.transcribe.find')} value={find} hasClear
        onChange={value => { setFind(value); setPage(1); }} />
      <TextInput label={t('@yovoice.transcribe.replaceWith')} isLabelHidden size="sm" placeholder={t('@yovoice.transcribe.replaceWith')} value={replacement} onChange={setReplacement} />
      <Button size="sm" variant="secondary" icon={<Replace />} label={t('@yovoice.transcribe.replaceAll')} isDisabled={!find} onClick={replace} />
      {find ? <small>{t('@yovoice.transcribe.matches', { count: matches.length })}</small> : null}
    </HStack> : null}
    <VStack ref={list} className="transcribe-lines" gap={0}>
      {!rows.length ? <p className="transcribe-empty" role="status">{empty}</p> : null}
      {rows.map(index => {
        const c = captions[index];
        const range = `${srtTime(c.start)} → ${srtTime(c.end)}`;
        return <HStack key={index} className="transcribe-line" data-line={index} data-playing={playing === index || undefined} gap={3} vAlign="start">
          {transcript.audioFile
            ? <Button size="sm" variant="ghost" className="transcribe-time" icon={playing === index ? <Square /> : <Play />} label={clock(c.start)} tooltip={range}
              isDisabled={!audioUrl} onClick={() => audition(index)} />
            : <small className="transcribe-time" title={range}>{clock(c.start)}</small>}
          <VStack className="grow transcribe-text" gap={0}>
            <CueText label={t('@yovoice.transcribe.lineText', { n: index + 1 })} value={c.text} maxLength={lineLimit}
              onChange={text => change(editText(captions, index, text), `text:${index}`)}
              onSplit={at => split(index, at)} onJoin={() => join(index)} onRemove={backward => remove(index, backward)} />
          </VStack>
          <HStack className="transcribe-line-actions" gap={0} vAlign="center">
            <Button size="sm" variant="ghost" isIconOnly icon={<Scissors />} label={t('@yovoice.transcribe.split')} tooltip={t('@yovoice.transcribe.splitHint')}
              onClick={() => split(index, field(index)?.selectionStart ?? 0)} />
            <Button size="sm" variant="ghost" isIconOnly icon={<Merge />} label={t('@yovoice.transcribe.mergeNext')} isDisabled={index + 1 >= captions.length} onClick={() => change(mergeNext(captions, index), 'merge')} />
            <Button size="sm" variant="ghost" isIconOnly icon={<Trash2 />} label={t('@yovoice.transcribe.deleteLine')} onClick={() => change(removeAt(captions, index), 'delete')} />
          </HStack>
        </HStack>;
      })}
    </VStack>
    {pages > 1 ? <HStack gap={3} vAlign="center" hAlign="end">
      <Button size="sm" variant="ghost" label={t('@yovoice.subtitle.previous')} isDisabled={current <= 1} onClick={() => setPage(current - 1)} />
      <small>{current} / {pages}</small>
      <Button size="sm" variant="ghost" label={t('@yovoice.subtitle.next')} isDisabled={current >= pages} onClick={() => setPage(current + 1)} />
    </HStack> : null}
  </VStack>;
}
