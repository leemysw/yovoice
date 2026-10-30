import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { call, isDesktop } from '../../shared/lib/client';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 播放页的沉浸式窗口与控件显隐：打开时聚焦播放页；桌面端 macOS 让网页铺进标题栏；播放中静置自动隐藏控件和指针；
// 全屏状态跟随 fullscreenchange；退出时先播放收起动画再关闭。busy 表示正在校准或逐字编辑，此时控件保持显示。
export function useImmersiveChrome({ stage, playing, busy, close }: { stage: RefObject<HTMLElement | null>; playing: boolean; busy: boolean; close: () => void }) {
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // 弹窗打开时焦点落在播放页本身，不选中关闭按钮，空格直接控制播放。
  useEffect(() => {
    const frame = requestAnimationFrame(() => stage.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [stage]);
  // 退出时先播放收起动画，动画结束再关闭；减少动态效果时直接关闭。动画结束事件和兜底的定时器只有一个会真正关闭。
  const closed = useRef(false);
  const finish = useCallback(() => { if (closed.current) return; closed.current = true; close(); }, [close]);
  const leave = () => {
    if (leaving) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (reducedMotion()) { finish(); return; }
    setLeaving(true);
  };
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(finish, 600);
    return () => clearTimeout(timer);
  }, [leaving, finish]);

  // 桌面端 macOS 打开播放页时让网页铺进标题栏，背景连成一片；控件随静置隐藏时窗口按钮也一起隐藏，关闭时恢复。
  const hidden = idle && !busy;
  useEffect(() => { if (isDesktop) void call('window.immersive', { active: true, chrome: !hidden }).catch(() => undefined); }, [hidden]);
  useEffect(() => () => { if (isDesktop) void call('window.immersive', { active: false, chrome: true }).catch(() => undefined); }, []);
  // 播放中鼠标静置 2.5 秒后隐藏控件和指针，录屏时画面只留封面与歌词；校准时保持显示。
  const lastActive = useRef(0);
  const wake = () => { lastActive.current = performance.now(); if (idle) setIdle(false); };
  useEffect(() => {
    if (!playing || busy) return;
    lastActive.current = performance.now();
    const timer = setInterval(() => { if (performance.now() - lastActive.current > 2500) setIdle(true); }, 500);
    return () => clearInterval(timer);
  }, [playing, busy]);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, [stage]);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stage.current?.requestFullscreen().catch(() => undefined);
  };
  return { hidden, fullscreen, leaving, wake, setIdle, toggleFullscreen, leave, finish };
}
