import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useLocale, useTranslator } from '@astryxdesign/core/i18n';
import { ArrowDown, ArrowLeftRight, AudioLines, Check, ChevronDown, Download, Eraser, FastForward, ListMusic, Maximize, Minimize, Pause, Play, Rewind, SlidersHorizontal, Timer } from 'lucide-react';
import { call, isDesktop, isMac, mediaUrl, saveText, releaseMediaUrl } from '../../shared/lib/client';
import { formatActivity, formatDateTime } from '../../shared/i18n/format';
import { noticeMessage } from '../../shared/lib/call-error';
import { formatTime, type Activity, type AlignedWord, type Generation } from '../../shared/workbench';
import { alignLines, alignedTimeline, alignLyrics, vocalActivity, withWords, type VocalActivity } from './lyric-align';
import { activeLyric, lyricRows, lyricTimeline, lyricsToLrc, type LyricLine } from './lyric-timing';
import { splitTags } from './music-draft';
import { editableLines, LyricWordEditor } from './lyric-word-editor';
import { backdropScene, phraseLayout, useKineticLyrics, useLyricFollow } from './kinetic-lyrics';
import { coverPalette, SongCover } from './song-cover';
import { readLocal, writeLocal } from '../../shared/lib/local-store';
import { decodeAudio } from '../../shared/lib/sound';

// 包络的时间分辨率（秒）：封面与背景随响度起伏。
const envelopeStep = 0.05;
// 快退、快进的步长（秒）。
const skipStep = 10;
// 校准时撤销一行后往回退的秒数，方便重新听到这一句的开头。
const undoRewind = 3;

// 超过这个时长（秒）的音频不再整段解码分析，避免长音频占满内存拖住界面（#92）；封面不起伏、歌词按时长估算。
const analyseLimit = 15 * 60;

// 读取整首音频：算出每 50ms 的响度（0~1）给动效用，并找出有人声的片段给歌词定位；失败时不起伏、歌词按时长估算。
// 人声检测本就在 16 kHz 上进行，直接按 16 kHz 解码，解码后的数据只有 48 kHz 的三分之一。
async function analyse(url: string, duration: number): Promise<{ envelope: number[]; activity?: VocalActivity; duration?: number }> {
  if (duration > analyseLimit) return { envelope: [] };
  try {
    const response = await fetch(url); if (!response.ok) return { envelope: [] };
    const buffer = await decodeAudio(await response.arrayBuffer(), 16000);
    const data = buffer.getChannelData(0), size = Math.max(1, Math.round(buffer.sampleRate * envelopeStep));
    const values = Array.from({ length: Math.ceil(data.length / size) }, (_, i) => {
      let sum = 0, count = 0;
      for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j += 16) { sum += data[j] * data[j]; count++; }
      return Math.sqrt(sum / Math.max(1, count));
    });
    const peak = Math.max(...values, 1e-6);
    const activity = vocalActivity(data, buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data, buffer.sampleRate);
    return { envelope: values.map(value => value / peak), activity, duration: buffer.duration };
  } catch { return { envelope: [] }; }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 歌词样式：scroll 是整首滚动、当前句逐字点亮；stage 是一句一屏，字随演唱逐个跃出并发光，适合录屏。选择记在本机。
type LyricStyle = 'scroll' | 'stage';
const lyricStyleKey = 'yovoice-lyric-style';
const savedLyricStyle = (): LyricStyle => readLocal(lyricStyleKey) === 'stage' ? 'stage' : 'scroll';

// 音乐播放页：仿 Apple Music 的全屏播放，左侧封面与播放控制，右侧滚动歌词；方便录屏，静置时自动隐藏控件和鼠标。
// 歌词时间先按音频里的人声片段自动定位，判断不可靠时按时长估算；可以边听边逐行校准，校准结果随版本保存。
// 每行再按人声分出逐字时间，当前句逐字点亮；也可以换成一句一屏的浮光样式。
// versions 是同一作品的各个版本：可以在播放页里切换版本对比试听，切换时保持播放位置，按 B 在最近两个版本之间来回切。
// 下载了可选的歌词对齐模型时可以一键逐字对齐（分离人声后强制对齐），结果随版本保存，和手动校准以最近一次为准；
// aligner 表示模型已安装，没装时 getAligner 打开设置里的下载项。activity 是当前后台任务，用来显示对齐进度。
export function NowPlaying({ item: opened, title: openedTitle, versions = [], aligner = false, activity, getAligner, close, onError }: {
  item: Generation; title: string; versions?: Generation[]; aligner?: boolean; activity?: Activity | null; getAligner?: () => void; close: () => void; onError: (message: string) => void;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const [item, setItem] = useState(opened);
  // 上一个听的版本，用来 A/B 来回切换。
  const [previous, setPrevious] = useState<Generation | null>(null);
  // 切换版本时记下的位置和播放状态，新音频加载后恢复。
  const resume = useRef<{ time: number; play: boolean } | null>(null);
  const title = item.id === opened.id ? openedTitle : item.title;
  // 版本号按生成先后从 1 开始，与版本记录一致。
  const ordered = useMemo(() => [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [versions]);
  const versionNumber = (value: Generation) => ordered.findIndex(entry => entry.id === value.id) + 1;
  const audio = useRef<HTMLAudioElement>(null);
  const stage = useRef<HTMLElement>(null);
  const lyricsBox = useRef<HTMLElement>(null);
  const [url, setUrl] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(item.duration);
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // times 是已保存的校准时间；sync 是正在校准时已标记的行开始时间，null 表示不在校准。
  const [times, setTimes] = useState(item.lyricTimes);
  // 对齐模型给出的逐字时间，有它时优先使用。
  const [aligned, setAligned] = useState(item.lyricWords);
  const [sync, setSync] = useState<number[] | null>(null);
  // 逐字编辑中的歌词（含器乐段落）和正在编辑的行号，null 表示不在编辑；编辑结果实时显示在歌词上。
  const [edit, setEdit] = useState<LyricLine[] | null>(null);
  const [editLine, setEditLine] = useState(0);
  const lineClick = useRef<((index: number) => void) | null>(null);
  const envelope = useRef<number[]>([]);
  // 音频分析得到的人声片段，用来自动定位歌词。
  const [voice, setVoice] = useState<{ activity: VocalActivity; duration: number } | null>(null);
  const lyrics = item.settings.instrumental ? '' : item.settings.lyrics ?? '';
  const rows = useMemo(() => lyricRows(lyrics), [lyrics]);
  const auto = useMemo(() => voice ? alignLyrics(rows, voice.activity, voice.duration) ?? undefined : undefined, [rows, voice]);
  // 逐字时间按音频里的人声片段分配；没有可靠的人声判断时按音节均分。
  const fromModel = useMemo(() => aligned?.length ? alignedTimeline(rows, aligned, duration) : null, [rows, aligned, duration]);
  const timeline = useMemo(() => fromModel ?? withWords(lyricTimeline(lyrics, duration, times ?? auto), voice?.activity), [fromModel, lyrics, duration, times, auto, voice]);
  const [lyricStyle, setLyricStyle] = useState(savedLyricStyle);
  const chooseStyle = (value: LyricStyle) => { setLyricStyle(value); writeLocal(lyricStyleKey, value); };
  // 校准时逐行显示，不补前奏；刚标记的一行视为当前句，下一行是待标记的目标。
  const lines: LyricLine[] = sync ? rows.map(row => ({ ...row, start: 0, end: 0 })) : edit ?? timeline;
  const current = sync ? sync.length - 1 : activeLyric(lines, time);
  const focus = sync ? Math.min(sync.length, lines.length - 1) : edit ? editLine : current;
  // 校准和逐字编辑时总用滚动歌词，方便看到上下文。
  const staged = lyricStyle === 'stage' && !sync && !edit && lines.length > 0;
  const { hue, accent } = coverPalette(item.id);
  const tags = splitTags(item.settings.text).slice(0, 4);
  const scene = useMemo(() => backdropScene(item.id), [item.id]);

  const switchTo = (next: Generation) => {
    if (next.id === item.id) return;
    const element = audio.current;
    resume.current = { time: element?.currentTime ?? time, play: !!element && !element.paused };
    envelope.current = [];
    setPrevious(item); setItem(next); setTimes(next.lyricTimes); setAligned(next.lyricWords); setVoice(null); setSync(null); setEdit(null); setDuration(next.duration);
  };
  // 对齐在后台完成后版本记录随状态更新，这里同步最新结果。
  const saved = versions.find(entry => entry.id === item.id);
  const savedKey = saved ? JSON.stringify([saved.lyricWords ?? null, saved.lyricTimes ?? null]) : '';
  const syncSaved = useEffectEvent(() => { if (saved) { setAligned(saved.lyricWords); setTimes(saved.lyricTimes); } });
  useEffect(() => { syncSaved(); }, [savedKey]);
  const running = activity?.status === 'running', aligning = running && activity.task === 'align' && activity.projectId === item.settings.id;
  const alignNow = () => {
    if (!aligner) { getAligner?.(); return; }
    void call('generation.alignLyrics', { id: item.id, lines: alignLines(timeline, duration) }).catch((error: unknown) => onError(noticeMessage(error)));
  };
  // 打开即开始播放；浏览器拦截自动播放时停在开头，由用户点播放。
  useEffect(() => {
    let disposed = false, resource = '';
    mediaUrl('outputs', item.fileName).then(value => {
      resource = value;
      if (disposed) { releaseMediaUrl(value); return; }
      setUrl(value);
      void analyse(value, item.duration).then(result => {
        if (disposed) return;
        envelope.current = result.envelope;
        if (result.activity && result.duration) setVoice({ activity: result.activity, duration: result.duration });
      });
    }, (error: Error) => { if (!disposed) onError(error.message); });
    return () => { disposed = true; releaseMediaUrl(resource); };
  }, [item.fileName, item.duration, onError]);
  // 弹窗打开时焦点落在播放页本身，不选中关闭按钮，空格直接控制播放。
  useEffect(() => {
    const frame = requestAnimationFrame(() => stage.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const play = () => audio.current?.play().catch((error: DOMException) => { if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') onError('@yovoice.error.audioPlayFailed'); });
  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) element.pause(); else void play();
  };
  const seek = (value: number) => {
    const next = Math.max(0, Math.min(duration || 0, value));
    if (audio.current) audio.current.currentTime = next;
    setTime(next);
  };
  // 退出时先播放收起动画，动画结束再关闭；减少动态效果时直接关闭。
  const leave = () => {
    if (leaving) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (reducedMotion()) { close(); return; }
    setLeaving(true);
  };
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(close, 600);
    return () => clearTimeout(timer);
  }, [leaving, close]);

  const save = (next: number[] | undefined) => {
    void call('generation.lyricTimes', { id: item.id, times: next ?? [] }).then(() => { setTimes(next); setAligned(undefined); }, (error: unknown) => onError(noticeMessage(error)));
  };
  // 逐字编辑从当前唱到的那一句开始；保存后与对齐结果一样记作逐字时间，替换逐行校准。
  const startEdit = () => {
    const draft = editableLines(timeline), at = activeLyric(draft, time);
    setEditLine(draft.findIndex((line, i) => i >= at && !line.instrumental && line.words?.length) >= 0 ? draft.findIndex((line, i) => i >= at && !line.instrumental && line.words?.length) : Math.max(0, draft.findIndex(line => !line.instrumental)));
    setEdit(draft); stage.current?.focus({ preventScroll: true });
  };
  const saveWords = (words: AlignedWord[]) => {
    void call('generation.lyricWords', { id: item.id, words }).then(() => { setAligned(words); setTimes(undefined); setEdit(null); }, (error: unknown) => onError(noticeMessage(error)));
  };
  // 从头播放开始校准；开头是器乐段落时它从 0 秒开始，自动标好。
  const startSync = () => { setSync(rows[0]?.instrumental ? [0] : []); seek(0); void play(); stage.current?.focus({ preventScroll: true }); };
  // 标记下一行从当前播放位置开始；最后一行标完即保存并退出校准。
  const mark = () => {
    if (!sync || !audio.current) return;
    const next = [...sync, Math.max(audio.current.currentTime, sync.at(-1) ?? 0)];
    if (next.length < rows.length) { setSync(next); return; }
    setSync(null); save(next);
  };
  // 按当前显示的歌词时间（校准、自动定位或估算）导出 LRC；words 为真时导出逐字时间。
  const exportLrc = (words = false) => { void saveText(lyricsToLrc(timeline, title, words), title, 'lrc').catch((error: unknown) => onError(noticeMessage(error))); };
  const undo = () => {
    if (!sync?.length) return;
    const last = sync.at(-1)!;
    setSync(sync.slice(0, -1)); seek(last - undoRewind);
  };

  // 播放中逐帧把当前响度写进样式变量，不经过 React 渲染。
  useEffect(() => {
    const element = audio.current, root = stage.current;
    if (!playing || !element || !root || reducedMotion()) return;
    let frame = 0, level = 0;
    const tick = () => {
      const target = envelope.current[Math.floor(element.currentTime / envelopeStep)] ?? 0;
      level += (target - level) * 0.25;
      root.style.setProperty('--now-playing-level', level.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); root.style.setProperty('--now-playing-level', '0'); };
  }, [playing]);
  // 逐字点亮：按播放位置把每个字的进度（--word-fill，0~1）和状态（data-sung）直接写到元素上，播放中逐帧更新，不经过 React 渲染。
  // 用布局阶段的 effect，换行后新出现的字在第一次绘制前就有正确的状态。
  useLayoutEffect(() => {
    const element = audio.current, root = stage.current;
    if (!element || !root) return;
    let frame = 0;
    const paint = () => {
      const now = element.currentTime;
      for (const word of root.querySelectorAll<HTMLElement>('[data-word-start]')) {
        const start = Number(word.dataset.wordStart), end = Number(word.dataset.wordEnd);
        word.style.setProperty('--word-fill', Math.max(0, Math.min(1, (now - start) / Math.max(.05, end - start))).toFixed(3));
        const state = now < start ? 'waiting' : now < end ? 'active' : 'done';
        if (word.dataset.sung !== state) word.dataset.sung = state;
      }
      if (!element.paused) frame = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(frame);
  }, [playing, time, current, staged, lines]);
  useKineticLyrics(stage, audio, staged);
  // 桌面端 macOS 打开播放页时让网页铺进标题栏，背景连成一片；控件随静置隐藏时窗口按钮也一起隐藏，关闭时恢复。
  const hidden = idle && !sync && !edit;
  useEffect(() => { if (isDesktop) void call('window.immersive', { active: true, chrome: !hidden }).catch(() => undefined); }, [hidden]);
  useEffect(() => () => { if (isDesktop) void call('window.immersive', { active: false, chrome: true }).catch(() => undefined); }, []);
  // 当前句（校准时是待标记的一行，编辑时是正在编辑的一句）平滑地停到歌词区中线。
  useLyricFollow(lyricsBox, focus, !staged && lines.length > 0);
  // 播放中鼠标静置 2.5 秒后隐藏控件和指针，录屏时画面只留封面与歌词；校准时保持显示。
  const lastActive = useRef(0);
  const wake = () => { lastActive.current = performance.now(); if (idle) setIdle(false); };
  useEffect(() => {
    if (!playing || sync || edit) return;
    lastActive.current = performance.now();
    const timer = setInterval(() => { if (performance.now() - lastActive.current > 2500) setIdle(true); }, 500);
    return () => clearInterval(timer);
  }, [playing, sync, edit]);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stage.current?.requestFullscreen().catch(() => undefined);
  };
  // 播放页是模态弹窗，按键在整个文档上监听，焦点落在哪里都能控制播放和校准。
  const keys = useEffectEvent((event: globalThis.KeyboardEvent) => {
    wake();
    if (event.target instanceof HTMLInputElement || (event.key === ' ' || event.key === 'Enter') && event.target instanceof HTMLButtonElement) return;
    if (edit) { if (event.key === ' ') { event.preventDefault(); toggle(); } return; }
    const action = event.key === ' ' ? toggle
      : sync && (event.key === 'ArrowDown' || event.key === 'Enter') ? mark
        : sync && event.key === 'Backspace' ? undo
          : !sync && previous && (event.key === 'b' || event.key === 'B') ? () => switchTo(previous)
            : !sync && event.key === 'ArrowLeft' ? () => seek(time - skipStep)
            : !sync && event.key === 'ArrowRight' ? () => seek(time + skipStep) : null;
    if (!action) return;
    event.preventDefault(); action();
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => keys(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  const progress = duration ? time / duration * 100 : 0;
  const lineState = (index: number) => index === current ? 'current' : index < current ? 'past' : 'next';
  // 滚动歌词只把当前句拆成逐字，其余行是整句文字。
  const lineText = (line: LyricLine, index: number) => line.instrumental ? '• • •'
    : !sync && index === current && line.words ? line.words.map((word, k) => <Text type="inherit" color="inherit" key={k} className="now-playing-word" data-word-start={String(word.start)} data-word-end={String(word.end)}>{word.text}</Text>) : line.text;
  // 浮光样式只显示当前句和正在飘走的上一句，下一句以小字预告；字的动效由 useKineticLyrics 逐帧驱动。
  const phrase = (index: number) => {
    const line = lines[index], words = line.words ?? [{ text: line.text, start: line.start, end: line.end }];
    const layout = phraseLayout({ ...line, words }, index);
    return <p key={`line-${index}`} className="now-playing-phrase" data-slot={index < current ? 'past' : 'current'} data-align={layout.align} data-instrumental={line.instrumental || undefined} aria-hidden={index !== current || undefined}
      style={{ '--phrase-fit': layout.fit } as CSSProperties}>
      {line.instrumental ? <Text type="inherit" color="inherit" className="now-playing-rest">• • •</Text> : words.map((word, k) => {
        const glyph = layout.glyphs[k];
        return <Text type="inherit" color="inherit" key={k} className="now-playing-glyph" data-hero={glyph.hero || undefined} data-index={k} data-text={word.text} data-word-start={String(word.start)} data-word-end={String(word.end)}
          data-x={glyph.x} data-y={glyph.y} data-rotate={glyph.rotate} data-scale={glyph.scale} data-turn={glyph.passedRotate} style={{ '--glyph-pad': `${glyph.pad.toFixed(3)}em` } as CSSProperties}>{word.text}</Text>;
      })}
    </p>;
  };
  const upcoming = lines[current + 1];
  return <Dialog className="now-playing-dialog" isOpen variant="fullscreen" padding={0} aria-label={t('@yovoice.music.nowPlayingTitle', { title })}
    onOpenChange={open => { if (open) return; if (sync) setSync(null); else if (edit) setEdit(null); else leave(); }}>
    <VStack ref={stage} tabIndex={-1} className="now-playing" data-playing={playing} data-idle={hidden} data-leaving={leaving || undefined} data-syncing={!!sync || undefined} data-editing={!!edit || undefined} data-host={isDesktop && isMac ? 'macos' : undefined} data-style={staged ? 'stage' : 'scroll'} gap={0}
      style={{ '--now-playing-hue': hue, '--now-playing-accent': accent } as CSSProperties}
      onPointerMove={wake} onPointerDown={wake}
      onAnimationEnd={event => { if (leaving && event.target === stage.current) close(); }}>
      <audio hidden ref={audio} src={url || undefined} autoPlay
        onLoadedMetadata={() => {
          const element = audio.current, value = element?.duration;
          if (value && Number.isFinite(value)) setDuration(value);
          const saved = resume.current; resume.current = null;
          if (!element || !saved) return;
          element.currentTime = Math.min(saved.time, value && Number.isFinite(value) ? value : saved.time);
          if (!saved.play) element.pause();
        }}
        onTimeUpdate={() => setTime(audio.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); setIdle(false); }} onEnded={() => setPlaying(false)} />
      <HStack className="now-playing-bar now-playing-chrome" gap={2} hAlign="between" vAlign="center">
        <Button className="now-playing-glass now-playing-round" label={t('@yovoice.music.closeNowPlaying')} isIconOnly variant="ghost" icon={<ChevronDown />} onClick={leave} />
        {ordered.length > 1 ? <HStack className="now-playing-versions" gap={1} vAlign="center">
          <DropdownMenu presentation="popover" alignment="center" menuWidth="max-content"
            button={{ className: 'now-playing-glass', size: 'sm', variant: 'ghost', label: t('@yovoice.app.historyVersion', { n: versionNumber(item) }), tooltip: t('@yovoice.music.compareVersions') }}
            items={[...ordered].reverse().map(entry => ({ id: entry.id, label: t('@yovoice.app.historyVersion', { n: versionNumber(entry) }), description: formatDateTime(entry.createdAt, locale, 'brief'),
              endContent: entry.id === item.id ? <Check size={14} /> : undefined, onClick: () => switchTo(entry) }))} />
          {previous && previous.id !== item.id ? <Button className="now-playing-glass" size="sm" variant="ghost" icon={<ArrowLeftRight />} label={t('@yovoice.music.switchBack', { n: versionNumber(previous) })} tooltip={t('@yovoice.music.switchBackHint')} onClick={() => switchTo(previous)} /> : null}
        </HStack> : null}
        <HStack gap={2} vAlign="center">
          {aligning ? <small className="now-playing-status" role="status">{formatActivity(t, activity)}</small> : null}
          {rows.length && !sync && !edit ? <DropdownMenu presentation="popover" alignment="end" menuWidth="max-content" hasChevron={false}
            button={{ className: 'now-playing-glass now-playing-round', variant: 'ghost', isIconOnly: true, icon: <ListMusic />, label: t('@yovoice.music.lyricTools'), tooltip: t('@yovoice.music.lyricTools'), isLoading: aligning }}
            items={[
              { type: 'section', id: 'timing', title: t(fromModel ? '@yovoice.music.lyricsAligned' : times ? '@yovoice.music.lyricsSynced' : auto ? '@yovoice.music.lyricsAnalyzed' : '@yovoice.music.lyricsEstimated'), items: [
                { id: 'align', icon: <AudioLines />, label: t(aligning ? '@yovoice.music.aligningLyrics' : '@yovoice.music.alignLyrics'), description: t(aligner ? '@yovoice.music.alignLyricsHint' : '@yovoice.music.alignLyricsDownload'), isDisabled: !url || running, onClick: alignNow },
                { id: 'words', icon: <SlidersHorizontal />, label: t('@yovoice.music.editWords'), description: t('@yovoice.music.editWordsHint'), isDisabled: !url || aligning || !timeline.length, onClick: startEdit },
                { id: 'sync', icon: <Timer />, label: t(times || fromModel ? '@yovoice.music.resyncLyrics' : '@yovoice.music.syncLyrics'), description: t('@yovoice.music.syncLyricsHint'), isDisabled: !url || aligning, onClick: startSync },
                ...(times || fromModel ? [{ id: 'reset', icon: <Eraser />, label: t('@yovoice.music.syncReset'), isDisabled: aligning, onClick: () => save(undefined) }] : []),
              ] },
              { type: 'divider' },
              { id: 'lrc', icon: <Download />, label: t('@yovoice.music.exportLrc'), isDisabled: !timeline.length, onClick: () => exportLrc() },
              { id: 'word-lrc', icon: <Download />, label: t('@yovoice.music.exportWordLrc'), description: t('@yovoice.music.exportWordLrcHint'), isDisabled: !timeline.length, onClick: () => exportLrc(true) },
            ]} /> : null}
          {rows.length ? <DropdownMenu presentation="popover" alignment="end" menuWidth="max-content"
            button={{ className: 'now-playing-glass now-playing-style', variant: 'ghost', size: 'sm', label: t(lyricStyle === 'stage' ? '@yovoice.music.lyricStyleStage' : '@yovoice.music.lyricStyleScroll'), tooltip: t('@yovoice.music.lyricStyle') }}
            items={(['scroll', 'stage'] as const).map(value => ({ id: value, label: t(value === 'stage' ? '@yovoice.music.lyricStyleStage' : '@yovoice.music.lyricStyleScroll'),
              description: t(value === 'stage' ? '@yovoice.music.lyricStyleStageHint' : '@yovoice.music.lyricStyleScrollHint'), endContent: lyricStyle === value ? <Check size={14} /> : undefined, onClick: () => chooseStyle(value) }))} /> : null}
          {document.fullscreenEnabled ? <Button className="now-playing-glass now-playing-round" label={t(fullscreen ? '@yovoice.music.exitFullscreen' : '@yovoice.music.fullscreen')} isIconOnly variant="ghost" icon={fullscreen ? <Minimize /> : <Maximize />} onClick={toggleFullscreen} /> : null}
        </HStack>
      </HStack>
      {staged ? <StackItem as="span" className="now-playing-backdrop" aria-hidden>
        <StackItem as="span" className="now-playing-backdrop-cover"><SongCover seed={item.id} animated={playing} size={96} /></StackItem>
        {scene.shapes.map((shape, index) => <StackItem as="span" key={index} className="now-playing-shape" data-shape={shape.type} data-filled={shape.filled || undefined}
          style={{ '--shape-x': `${shape.x}%`, '--shape-y': `${shape.y}%`, '--shape-size': shape.size, '--shape-dir': shape.reverse ? -1 : 1, '--shape-rotate': `${shape.rotate}deg`, '--shape-opacity': shape.opacity, '--shape-band': shape.band,
            animationDuration: `${shape.duration}s`, animationDelay: `${shape.delay}s` } as CSSProperties}><StackItem as="span" className="now-playing-shape-face" /></StackItem>)}
        {scene.motes.map((mote, index) => <StackItem as="span" key={`mote-${index}`} className="now-playing-mote"
          style={{ '--mote-x': `${mote.x}%`, '--mote-y': `${mote.y}%`, '--mote-size': mote.size, '--mote-peak': mote.peak, animationDuration: `${mote.duration}s`, animationDelay: `${mote.delay}s` } as CSSProperties} />)}
      </StackItem> : null}
      <HStack className={`now-playing-stage ${lines.length ? '' : 'now-playing-solo'}`.trim()} gap={0} vAlign="center">
        <VStack className="now-playing-side" gap={6}>
          <VStack className="now-playing-art" gap={0}><SongCover seed={item.id} animated={playing} size={640} /></VStack>
          <VStack className="now-playing-meta" gap={1}>
            <h2 className="now-playing-title">{title}</h2>
            <p className="now-playing-tags">{item.settings.instrumental ? t('@yovoice.music.instrumental') : tags.join(' · ')}</p>
          </VStack>
          <VStack className="now-playing-controls now-playing-chrome" gap={2}>
            <input className="now-playing-progress" aria-label={t('@yovoice.player.progress')} aria-valuetext={t('@yovoice.player.progressValue', { current: formatTime(time), total: formatTime(duration) })} type="range" min={0} max={duration || 1} step={0.01} value={time} disabled={!url} onChange={event => seek(Number(event.target.value))} style={{ '--now-playing-progress': `${progress}%` } as CSSProperties} />
            <HStack className="now-playing-times" hAlign="between"><small>{formatTime(time)}</small><small>-{formatTime(Math.max(0, duration - time))}</small></HStack>
            <HStack className="now-playing-transport" gap={6} hAlign="center" vAlign="center">
              <Button className="now-playing-skip" label={t('@yovoice.music.rewind', { n: skipStep })} isIconOnly variant="ghost" icon={<Rewind fill="currentColor" />} isDisabled={!url} onClick={() => seek(time - skipStep)} />
              <Button className="now-playing-toggle" label={playing ? t('@yovoice.player.pause') : t('@yovoice.player.play')} isIconOnly variant="ghost" icon={playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />} isDisabled={!url} onClick={toggle} />
              <Button className="now-playing-skip" label={t('@yovoice.music.forward', { n: skipStep })} isIconOnly variant="ghost" icon={<FastForward fill="currentColor" />} isDisabled={!url} onClick={() => seek(time + skipStep)} />
            </HStack>
          </VStack>
        </VStack>
        {staged ? <VStack className="now-playing-kinetic" gap={0} role="group" aria-label={t('@yovoice.music.lyrics')}>
          {[current - 1, current].filter(index => index >= 0 && index < lines.length).map(phrase)}
          {upcoming ? <p key={`next-${current + 1}`} className="now-playing-phrase now-playing-upcoming" data-slot="next" aria-hidden>{upcoming.instrumental ? '• • •' : upcoming.text}</p> : null}
        </VStack> : lines.length ? <VStack ref={lyricsBox} className="now-playing-lyrics" gap={0} role="list" aria-label={t('@yovoice.music.lyrics')}>
          {lines.map((line, index) => <p key={`${sync ? 'sync' : 'play'}-${index}`} role="listitem" data-index={index} className="now-playing-line" data-state={lineState(index)}
            data-target={sync && index === sync.length || undefined} data-instrumental={line.instrumental || undefined}
            data-editing={edit && index === editLine || undefined}
            title={sync || line.instrumental ? undefined : t(edit ? '@yovoice.music.editThisLine' : '@yovoice.music.seekLyric')} onClick={() => {
              if (sync || line.instrumental) return;
              if (edit) { lineClick.current?.(index); return; }
              seek(line.start); if (audio.current?.paused) void play();
            }}>
            {lineText(line, index)}
          </p>)}
        </VStack> : null}
      </HStack>
      {sync ? <HStack className="now-playing-sync" gap={3} vAlign="center" wrap="wrap" role="group" aria-label={t('@yovoice.music.syncLyrics')}>
        <small className="now-playing-sync-hint">{t('@yovoice.music.syncHint')}</small>
        <small className="now-playing-sync-count">{t('@yovoice.music.syncProgress', { done: sync.length, total: rows.length })}</small>
        <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.syncUndo')} isDisabled={!sync.length} onClick={undo} />
        <Button className="now-playing-glass" size="sm" variant="ghost" label={t('@yovoice.music.syncCancel')} onClick={() => setSync(null)} />
        <Button className="now-playing-mark" size="sm" variant="ghost" icon={<ArrowDown />} label={t('@yovoice.music.syncNext')} isDisabled={!url} onClick={mark} />
      </HStack> : edit ? <LyricWordEditor lines={edit} setLines={setEdit} line={editLine} setLine={setEditLine} audio={audio} duration={duration} seek={seek} play={() => void play()} lineClick={lineClick} onSave={saveWords} onCancel={() => setEdit(null)} /> : null}
    </VStack>
  </Dialog>;
}
