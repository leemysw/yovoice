import { useEffect, useRef } from 'react';

// 同一版本 ID 总是得到同一张封面：色相、波纹位置与线条都由 ID 派生。
function random(seed: string) {
  let state = 0;
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) >>> 0;
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export function drawCover(canvas: HTMLCanvasElement, seed: string, time = 0) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const next = random(seed); const { width, height } = canvas;
  const hue = Math.floor(next() * 360), accent = (hue + 40 + next() * 120) % 360;
  const ground = context.createLinearGradient(0, 0, width, height);
  ground.addColorStop(0, `hsl(${hue} 55% 16%)`); ground.addColorStop(1, `hsl(${accent} 60% 30%)`);
  context.fillStyle = ground; context.fillRect(0, 0, width, height);
  const x = width * (0.25 + next() * 0.5), y = height * (0.3 + next() * 0.4), rings = 7 + Math.floor(next() * 6);
  for (let i = rings; i > 0; i--) {
    context.beginPath();
    context.arc(x, y, (i / rings) * width * 0.62 + Math.sin(time / 600 + i) * width * 0.006, 0, Math.PI * 2);
    context.fillStyle = `hsl(${(hue + i * 14) % 360} 80% ${30 + i * 4}% / ${0.18 + (rings - i) * 0.03})`;
    context.fill();
  }
  context.lineWidth = Math.max(1, width / 120);
  for (let line = 0; line < 3; line++) {
    const base = height * (0.62 + line * 0.09), amplitude = height * (0.02 + next() * 0.05), frequency = 2 + next() * 5;
    context.beginPath();
    for (let px = 0; px <= width; px += 2) context.lineTo(px, base + Math.sin(px / width * Math.PI * frequency + time / 500 + line) * amplitude);
    context.strokeStyle = `hsl(${accent} 90% 85% / ${0.55 - line * 0.15})`;
    context.stroke();
  }
}

// 播放中的封面缓慢起伏；系统要求减少动态时保持静止。
export function SongCover({ seed, animated = false, size = 320 }: { seed: string; animated?: boolean; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const still = !animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { drawCover(element, seed); return; }
    let frame = 0;
    const tick = (time: number) => { drawCover(element, seed, time); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seed, animated]);
  return <canvas ref={canvas} className="song-cover" width={size} height={size} aria-hidden="true" />;
}
