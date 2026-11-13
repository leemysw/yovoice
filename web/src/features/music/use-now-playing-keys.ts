import { useEffect, useEffectEvent, type RefObject } from 'react';
import { composing, useHotkey } from '../../shared/hotkeys/hotkeys';
import type { LyricTiming } from './use-lyric-timing';

// 播放页的键盘控制。播放页是全屏弹窗，命令都限定在播放页（stage，打开时聚焦）里，上面盖着速查浮层、确认框时不作用到背后；
// 按键可以在设置里改：播放暂停、快退快进、和上一个版本来回切、歌词工具（对齐、校准、逐字编辑、导出 LRC）、歌词样式和全屏。
// 校准时 ↓/回车标记下一行、退格撤销是固定按键，留在文档监听里处理；任何按键都会唤醒静置时隐藏的控件。
// 逐字编辑时方向键、回车归逐字编辑器，这里只保留播放暂停；校准与逐字编辑时总用滚动歌词，歌词样式键停用。
export function useNowPlayingKeys({ stage, wake, timing, url, toggle, rewind, forward, switchBack, toggleStyle, toggleFullscreen }: {
  stage: RefObject<HTMLElement | null>; wake: () => void; timing: LyricTiming; url: string; toggle: () => void; rewind: () => void; forward: () => void;
  switchBack: (() => void) | null; toggleStyle: () => void; toggleFullscreen: () => void;
}) {
  const { sync, edit, rows, timeline, running, aligning, mark, undo, alignByKey, startSync, startEdit, exportLrc } = timing;
  // 校准的固定按键：别处已处理、输入法组字、焦点在菜单里或不在播放页里（上面盖着别的对话框）时不接管；
  // 按住不放的重复按键只拦下，不连续标记或撤销。回车落在按钮上时交给按钮。
  const fixed = useEffectEvent((event: globalThis.KeyboardEvent) => {
    wake();
    if (!sync || event.defaultPrevented || composing(event) || event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !stage.current?.contains(target) || target instanceof HTMLInputElement || target.closest('[role="menu"], [role="listbox"]')) return;
    const marking = event.key === 'ArrowDown' || (event.key === 'Enter' && !target.closest('button, [role="button"]'));
    if (!marking && event.key !== 'Backspace') return;
    event.preventDefault();
    if (event.repeat) return;
    if (marking) mark(); else undo();
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => fixed(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const idle = !sync && !edit, lyrics = idle && rows.length > 0;
  useHotkey('nowPlaying.play', toggle, { within: stage, enabled: !!url });
  useHotkey('global.playPause', toggle, { within: stage, enabled: !!url, inInput: true });
  useHotkey('nowPlaying.back', rewind, { within: stage, enabled: !!url && idle, repeat: true });
  useHotkey('nowPlaying.forward', forward, { within: stage, enabled: !!url && idle, repeat: true });
  useHotkey('nowPlaying.switch', () => switchBack?.(), { within: stage, enabled: !!switchBack && idle });
  useHotkey('nowPlaying.align', alignByKey, { within: stage, enabled: lyrics && !!url && !running });
  useHotkey('nowPlaying.sync', startSync, { within: stage, enabled: lyrics && !!url && !aligning });
  useHotkey('nowPlaying.words', startEdit, { within: stage, enabled: lyrics && !!url && !aligning && timeline.length > 0 });
  useHotkey('nowPlaying.exportLrc', () => exportLrc(), { within: stage, enabled: lyrics && timeline.length > 0 });
  useHotkey('nowPlaying.lyricStyle', toggleStyle, { within: stage, enabled: lyrics });
  useHotkey('nowPlaying.fullscreen', toggleFullscreen, { within: stage, enabled: document.fullscreenEnabled });
}
