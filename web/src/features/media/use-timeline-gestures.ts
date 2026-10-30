import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { AudioTimeline } from '../../shared/workbench';

// 进行中的手势：起点与最近的指针位置、按下时的滚动量，以及把位移换算成预览的 apply。
type Gesture = { x: number; y: number; clientX: number; clientY: number; alt: boolean; scroll: number; vertical: number; moved: boolean; raf: number; clickTime?: number; apply: (x: number, y: number, alt: boolean) => void };

// 时间线指针手势：按下后逐帧跟随指针，拖到边缘时自动滚动；移动、裁剪与框选只改预览，抬起时一次性提交为编辑。
export function useTimelineGestures({ scrollRef, blocked, stop, seek, edit, setRange }: {
  scrollRef: RefObject<HTMLElement | null>; blocked: boolean; stop: () => void; seek: (time: number) => void;
  edit: (next: AudioTimeline) => void; setRange: (range: { start: number; end: number } | undefined) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const gestureNext = useRef<AudioTimeline | null>(null);
  const suppressClick = useRef(false);
  const [trimPreview, setTrimPreview] = useState<AudioTimeline | null>(null);
  const [guide, setGuide] = useState<number>();
  // 卸载时取消未完成拖动的跟随帧。
  useEffect(() => () => { if (gesture.current) cancelAnimationFrame(gesture.current.raf); gesture.current = null; }, []);
  const finishGesture = (commit: boolean) => {
    if (gesture.current) {
      cancelAnimationFrame(gesture.current.raf); suppressClick.current = gesture.current.moved;
      if (commit && !gesture.current.moved && gesture.current.clickTime !== undefined) { seek(gesture.current.clickTime); setRange(undefined); }
    }
    gesture.current = null; setTrimPreview(null); setGuide(undefined);
    const next = gestureNext.current; gestureNext.current = null;
    if (commit && next) edit(next);
  };
  const preview = (next: AudioTimeline) => { gestureNext.current = next; setTrimPreview(next); };
  const beginGesture = (event: ReactPointerEvent<HTMLElement>, apply: (x: number, y: number, alt: boolean) => void, clickTime?: number) => {
    if (event.button !== 0 || blocked) return;
    event.preventDefault(); event.stopPropagation(); stop(); event.currentTarget.focus({ preventScroll: true });
    const scroll = scrollRef.current!; scroll.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    gesture.current = { x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY, alt: event.altKey, scroll: scroll.scrollLeft, vertical: scroll.scrollTop, moved: false, raf: 0, clickTime, apply };
    const tick = () => {
      const g = gesture.current; if (!g) return;
      const rect = scroll.getBoundingClientRect();
      if (g.moved) {
        const margin = 32, label = scroll.querySelector('.multitrack-label')?.clientWidth ?? 0;
        scroll.scrollLeft += g.clientX > rect.right - margin ? (g.clientX - rect.right + margin) / 3 : g.clientX < rect.left + label + margin ? (g.clientX - rect.left - label - margin) / 3 : 0;
        scroll.scrollTop += g.clientY > rect.bottom - margin ? 6 : g.clientY < rect.top + margin ? -6 : 0;
        g.apply(g.clientX - g.x + scroll.scrollLeft - g.scroll, g.clientY - g.y + scroll.scrollTop - g.vertical, g.alt);
      }
      g.raf = requestAnimationFrame(tick);
    }; tick();
  };
  const moveGesture = (e: ReactPointerEvent<HTMLElement>) => { const g = gesture.current; if (!g) return; g.clientX = e.clientX; g.clientY = e.clientY; g.alt = e.altKey; g.moved ||= Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 3; if (g.moved) g.apply(e.clientX - g.x + scrollRef.current!.scrollLeft - g.scroll, e.clientY - g.y + scrollRef.current!.scrollTop - g.vertical, e.altKey); };
  const pointerHandlers = { onPointerMove: moveGesture, onPointerUp: () => finishGesture(true), onPointerCancel: () => finishGesture(false), onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => { if (e.target === e.currentTarget) finishGesture(false); } };
  return { gesture, suppressClick, trimPreview, setTrimPreview, guide, setGuide, finishGesture, preview, beginGesture, pointerHandlers };
}

export type TimelineGestures = ReturnType<typeof useTimelineGestures>;
