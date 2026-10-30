import { useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { useTranslator } from '@astryxdesign/core/i18n';
import { CircleAlert, FastForward, Pause, Play, Rewind, X } from 'lucide-react';
import { isDesktop, isMac } from '../../shared/lib/client';
import { formatNotice } from '../../shared/i18n/format';
import { formatTime, type Activity, type Generation } from '../../shared/workbench';
import { splitTags } from './music-draft';
import { LyricWordEditor } from './lyric-word-editor';
import { useKineticLyrics, useLyricFollow } from './kinetic-lyrics';
import { coverPalette, SongCover } from './song-cover';
import { useSongAnalysis } from './use-song-analysis';
import { useLyricTiming } from './use-lyric-timing';
import { useImmersiveChrome } from './use-immersive-chrome';
import { useNowPlayingKeys } from './use-now-playing-keys';
import { NowPlayingToolbar, useLyricStyle } from './now-playing-toolbar';
import { ScrollLyrics } from './scroll-lyrics';
import { StageBackdrop, StageLyrics } from './stage-lyrics';
import { LyricSyncBar } from './lyric-sync-bar';

// 快退、快进的步长（秒）。
const skipStep = 10;

// 音乐播放页：仿 Apple Music 的全屏播放，左侧封面与播放控制，右侧滚动歌词；方便录屏，静置时自动隐藏控件和鼠标。
// 歌词时间先按音频里的人声片段自动定位，判断不可靠时按时长估算；可以边听边逐行校准，校准结果随版本保存。
// 每行再按人声分出逐字时间，当前句逐字点亮；也可以换成一句一屏的浮光样式。
// versions 是同一作品的各个版本：可以在播放页里切换版本对比试听，切换时保持播放位置，按 B 在最近两个版本之间来回切。
// 下载了可选的歌词对齐模型时可以一键逐字对齐（分离人声后强制对齐），结果随版本保存，和手动校准以最近一次为准；
// aligner 表示模型已安装，没装时 getAligner 打开设置里的下载项。activity 是当前后台任务，用来显示对齐进度。
// 播放页是全屏弹窗，会盖住全局通知：读取、保存、对齐、导出失败都在页内的提示条里显示。
// 音频分析、歌词时间状态、沉浸式窗口和键盘分别在 useSongAnalysis、useLyricTiming、useImmersiveChrome、useNowPlayingKeys 里，这里负责播放与版本切换并组装页面。
export function NowPlaying({ item: opened, title: openedTitle, versions = [], aligner = false, activity, getAligner, close }: {
  item: Generation; title: string; versions?: Generation[]; aligner?: boolean; activity?: Activity | null; getAligner?: () => void; close: () => void;
}) {
  const t = useTranslator();
  const [item, setItem] = useState(opened);
  // 页内的错误提示：存 noticeMessage 生成的文本，显示时翻译。
  const [notice, setNotice] = useState('');
  // 上一个听的版本，用来 A/B 来回切换。
  const [previous, setPrevious] = useState<Generation | null>(null);
  // 切换版本时记下的位置和播放状态，新音频加载后恢复。
  const resume = useRef<{ time: number; play: boolean } | null>(null);
  const title = item.id === opened.id ? openedTitle : item.title;
  const audio = useRef<HTMLAudioElement>(null);
  const stage = useRef<HTMLElement>(null);
  const lyricsBox = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(item.duration);
  const { url, voice, reset: resetAnalysis } = useSongAnalysis({ item, audio, stage, playing, setNotice });
  const play = () => audio.current?.play().catch((error: DOMException) => { if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') setNotice('@yovoice.error.audioPlayFailed'); });
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
  const timing = useLyricTiming({ item, versions, title, voice, duration, time, audio, stage, aligner, activity, getAligner, seek, play, setNotice });
  const { rows, sync, setSync, edit, setEdit, editLine, setEditLine, lineClick, lines, current, focus, mark, undo, saveWords } = timing;
  const [lyricStyle, chooseStyle] = useLyricStyle();
  // 校准和逐字编辑时总用滚动歌词，方便看到上下文。
  const staged = lyricStyle === 'stage' && !sync && !edit && lines.length > 0;
  const { hue, accent } = coverPalette(item.id);
  const tags = splitTags(item.settings.text).slice(0, 4);

  const switchTo = (next: Generation) => {
    if (next.id === item.id) return;
    const element = audio.current;
    resume.current = { time: element?.currentTime ?? time, play: !!element && !element.paused };
    resetAnalysis();
    setPrevious(item); setItem(next); timing.reset(next); setDuration(next.duration);
  };
  const { hidden, fullscreen, leaving, wake, setIdle, toggleFullscreen, leave, finish } = useImmersiveChrome({ stage, playing, busy: !!sync || !!edit, close });

  // 逐字点亮：按播放位置把每个字的进度（--word-fill，0~1）和状态（data-sung）直接写到元素上，播放中逐帧更新，不经过 React 渲染。
  const paintWords = useEffectEvent(() => {
    const element = audio.current, root = stage.current;
    if (!element || !root) return;
    const now = element.currentTime;
    for (const word of root.querySelectorAll<HTMLElement>('[data-word-start]')) {
      const start = Number(word.dataset.wordStart), end = Number(word.dataset.wordEnd);
      word.style.setProperty('--word-fill', Math.max(0, Math.min(1, (now - start) / Math.max(.05, end - start))).toFixed(3));
      const state = now < start ? 'waiting' : now < end ? 'active' : 'done';
      if (word.dataset.sung !== state) word.dataset.sung = state;
    }
  });
  // 用布局阶段的 effect，换行后新出现的字在第一次绘制前就有正确的状态；播放中的逐帧循环不随 timeupdate 重启。
  useLayoutEffect(() => {
    const element = audio.current;
    if (!element) return;
    let frame = 0;
    const loop = () => { paintWords(); if (!element.paused) frame = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [playing, current, staged, lines]);
  // 暂停时拖进度条或点歌词跳转，也要刷新一次逐字状态。
  useLayoutEffect(() => { if (!playing) paintWords(); }, [time, playing]);
  useKineticLyrics(stage, audio, staged);
  // 当前句（校准时是待标记的一行，编辑时是正在编辑的一句）平滑地停到歌词区中线。
  useLyricFollow(lyricsBox, focus, !staged && lines.length > 0);
  const rewind = () => seek(time - skipStep), forward = () => seek(time + skipStep);
  useNowPlayingKeys({ wake, editing: !!edit, syncing: !!sync, toggle, mark, undo, switchBack: previous ? () => switchTo(previous) : null, rewind, forward });
  const progress = duration ? time / duration * 100 : 0;
  return <Dialog className="now-playing-dialog" isOpen variant="fullscreen" padding={0} aria-label={t('@yovoice.music.nowPlayingTitle', { title })}
    onOpenChange={open => { if (open) return; if (sync) setSync(null); else if (edit) setEdit(null); else leave(); }}>
    <VStack ref={stage} tabIndex={-1} className="now-playing" data-playing={playing} data-idle={hidden} data-leaving={leaving || undefined} data-syncing={!!sync || undefined} data-editing={!!edit || undefined} data-host={isDesktop && isMac ? 'macos' : undefined} data-style={staged ? 'stage' : 'scroll'} gap={0}
      style={{ '--now-playing-hue': hue, '--now-playing-accent': accent } as CSSProperties}
      onPointerMove={wake} onPointerDown={wake}
      onAnimationEnd={event => { if (leaving && event.target === stage.current) finish(); }}>
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
      <NowPlayingToolbar item={item} versions={versions} previous={previous} switchTo={switchTo} url={url} aligner={aligner} activity={activity} timing={timing}
        lyricStyle={lyricStyle} chooseStyle={chooseStyle} fullscreen={fullscreen} toggleFullscreen={toggleFullscreen} leave={leave} />
      {notice ? <HStack className="now-playing-notice" role="alert" gap={2} vAlign="center" data-testid="now-playing-notice">
        <CircleAlert size={14} aria-hidden />
        <small className="grow">{formatNotice(t, notice)}</small>
        <Button className="now-playing-glass now-playing-round" size="sm" variant="ghost" isIconOnly icon={<X size={14} />} label={t('@yovoice.action.closeNotice')} onClick={() => setNotice('')} />
      </HStack> : null}
      {staged ? <StageBackdrop seed={item.id} playing={playing} /> : null}
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
              <Button className="now-playing-skip" label={t('@yovoice.music.rewind', { n: skipStep })} isIconOnly variant="ghost" icon={<Rewind fill="currentColor" />} isDisabled={!url} onClick={rewind} />
              <Button className="now-playing-toggle" label={playing ? t('@yovoice.player.pause') : t('@yovoice.player.play')} isIconOnly variant="ghost" icon={playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />} isDisabled={!url} onClick={toggle} />
              <Button className="now-playing-skip" label={t('@yovoice.music.forward', { n: skipStep })} isIconOnly variant="ghost" icon={<FastForward fill="currentColor" />} isDisabled={!url} onClick={forward} />
            </HStack>
          </VStack>
        </VStack>
        {staged ? <StageLyrics lines={lines} current={current} />
          : lines.length ? <ScrollLyrics box={lyricsBox} lines={lines} current={current} sync={sync} editing={!!edit} editLine={editLine} lineClick={lineClick} audio={audio} seek={seek} play={() => void play()} /> : null}
      </HStack>
      {sync ? <LyricSyncBar done={sync.length} total={rows.length} ready={!!url} undo={undo} cancel={() => setSync(null)} mark={mark} />
        : edit ? <LyricWordEditor lines={edit} setLines={setEdit} line={editLine} setLine={setEditLine} audio={audio} duration={duration} seek={seek} play={() => void play()} lineClick={lineClick} onSave={saveWords} onCancel={() => setEdit(null)} /> : null}
    </VStack>
  </Dialog>;
}
