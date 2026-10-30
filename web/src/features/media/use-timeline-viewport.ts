import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// 时间线视口：横向范围、缩放及其锚点补偿、滚动与标尺尺寸测量，以及标尺只绘制可见区所需的刻度范围。
export function useTimelineViewport(duration: number) {
  const scrollRef = useRef<HTMLElement>(null);
  const rulerRef = useRef<HTMLElement>(null);
  const zoomAnchor = useRef<{ time: number; x: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  // 100% 默认显示十秒，长工程横向延展；增加片段不压缩已有片段。
  const [extent, setExtent] = useState(() => Math.max(duration * 1.2 + 2, 10));
  const scale = extent;
  const fitExtent = Math.max(duration * 1.2 + 2, 10);
  const minZoom = 10 / fitExtent;
  const fitAll = () => { zoomAnchor.current = null; setExtent(fitExtent); setZoom(minZoom); if (scrollRef.current) scrollRef.current.scrollLeft = 0; };
  useEffect(() => { if (duration > extent - 1) setExtent(Math.max(duration * 1.2 + 2, 10)); }, [duration, extent]);
  const zoomTo = (next: number, anchorX?: number) => {
    const ruler = rulerRef.current?.getBoundingClientRect(), scroll = scrollRef.current?.getBoundingClientRect();
    if (ruler && scroll) { const x = anchorX ?? scroll.left + scroll.width / 2; zoomAnchor.current = { time: (x - ruler.left) / ruler.width * scale, x }; }
    setZoom(Math.max(minZoom, Math.min(32, next)));
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current, ruler = rulerRef.current, scroll = scrollRef.current;
    if (anchor && ruler && scroll) { scroll.scrollLeft += ruler.getBoundingClientRect().left + anchor.time / scale * ruler.clientWidth - anchor.x; zoomAnchor.current = null; }
  }, [zoom, scale]);
  useEffect(() => { const element = scrollRef.current; if (!element) return; const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX); } }; element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel); });
  const [rulerWidth, setRulerWidth] = useState(1000);
  const [viewport, setViewport] = useState({ left: 0, width: 1000 });
  useEffect(() => {
    const ruler = rulerRef.current, scroll = scrollRef.current; if (!ruler || !scroll) return;
    const measure = () => { setRulerWidth(Math.max(1, ruler.clientWidth)); setViewport({ left: scroll.scrollLeft, width: scroll.clientWidth }); };
    const observer = new ResizeObserver(measure); observer.observe(ruler); observer.observe(scroll);
    scroll.addEventListener('scroll', measure, { passive: true }); measure();
    return () => { observer.disconnect(); scroll.removeEventListener('scroll', measure); };
  }, []);
  const tickStep = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1800, 3600, 7200].find(step => step / scale * rulerWidth >= 70) ?? 7200;

  // 标尺只绘制可见区，长工程放大后也不创建成千上万个刻度。
  const firstTick = Math.max(0, Math.floor(viewport.left / rulerWidth * scale / tickStep) - 1);
  const tickCount = Math.min(Math.floor(scale / tickStep) - firstTick + 1, Math.ceil(viewport.width / rulerWidth * scale / tickStep) + 3);

  // 让一段范围占满视口八成宽度，起点贴着轨道区左缘。
  const fitRange = (target: { start: number; end: number }) => { zoomAnchor.current = { time: target.start, x: (scrollRef.current?.getBoundingClientRect().left ?? 0) + (scrollRef.current?.querySelector('.multitrack-label')?.clientWidth ?? 0) }; setZoom(Math.min(32, Math.max(minZoom, 10 / (target.end - target.start) * 0.8))); };

  return { scrollRef, rulerRef, zoom, scale, minZoom, zoomTo, fitAll, fitRange, tickStep, firstTick, tickCount };
}
