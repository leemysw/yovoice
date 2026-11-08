import { useLayoutEffect, useRef } from 'react';

// 内容变高变矮时让外框跟着平滑过渡：外框包住一个内容元素，内容的自然高度一变，外框就从旧高度动画到新高度，
// 外框之后的元素（弹窗边缘、下方的面板内容）随之平移，而不是一帧跳过去。
// 用法：ref 挂在外框上，外框里只放一个子元素作为内容。减少动态效果时不做动画。
export function useHeightMorph<T extends HTMLElement>() {
  const frame = useRef<T>(null);
  useLayoutEffect(() => {
    const outer = frame.current;
    const inner = outer?.firstElementChild as HTMLElement | null;
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return;
    let last = inner.getBoundingClientRect().height;
    let running: Animation | null = null;
    const observer = new ResizeObserver(() => {
      const next = inner.getBoundingClientRect().height;
      if (Math.abs(next - last) < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.hidden) { last = next; return; }
      // 上一段还没走完时从当前实际高度接着走，连续变化不回跳。
      const from = running ? outer.getBoundingClientRect().height : last;
      running?.cancel();
      last = next;
      const style = getComputedStyle(document.documentElement);
      const duration = parseFloat(style.getPropertyValue('--duration-medium-min')) || 310;
      const easing = style.getPropertyValue('--ease-standard').trim() || 'ease-out';
      outer.style.overflow = 'clip';
      running = outer.animate([{ height: `${from}px` }, { height: `${next}px` }], { duration, easing });
      const done = () => { running = null; outer.style.overflow = ''; };
      running.onfinish = done;
      running.oncancel = () => { if (!running) outer.style.overflow = ''; };
    });
    observer.observe(inner);
    return () => { observer.disconnect(); running?.cancel(); };
  }, []);
  return frame;
}
