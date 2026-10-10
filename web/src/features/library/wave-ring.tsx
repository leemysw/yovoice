import { useEffect, useRef, type ReactNode } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { random } from './record-cover';

// 参考音频的封面：头像外围一圈放射状声波，形状由音频 ID 和时长决定；播放时整圈缓慢转动并起伏。
function drawRing(canvas: HTMLCanvasElement, seed: string, duration: number) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const s = canvas.width, x = s / 2, inner = s * .33, outer = s * .49, next = random(`${seed}:ring`);
  const bars = 64, phase = next() * Math.PI * 2, bumps = 3 + Math.floor(next() * 4);
  // 时长越长，声波越密集起伏；最短的样本也保留一点起伏。
  const busy = Math.min(1, .35 + duration / 30);
  c.clearRect(0, 0, s, s);
  c.beginPath(); c.arc(x, x, outer, 0, Math.PI * 2); c.fillStyle = 'rgb(24 24 26 / 5%)'; c.fill();
  c.lineCap = 'round';
  for (let i = 0; i < bars; i++) {
    const a = i / bars * Math.PI * 2;
    const envelope = .5 + .5 * Math.sin(a * bumps + phase);
    const level = Math.max(.12, Math.min(1, envelope * .7 + next() * .5 * busy));
    const r = inner + (outer - inner) * level;
    c.beginPath(); c.moveTo(x + Math.cos(a) * (inner + 2), x + Math.sin(a) * (inner + 2)); c.lineTo(x + Math.cos(a) * r, x + Math.sin(a) * r);
    c.strokeStyle = `rgb(24 24 26 / ${35 + level * 50}%)`; c.lineWidth = s / 90; c.stroke();
  }
}

export function WaveRing({ seed, duration, children }: { seed: string; duration: number; children: ReactNode }) {
  const ring = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ring.current) drawRing(ring.current, seed, duration); }, [seed, duration]);
  return <HStack className="wave-ring" gap={0} hAlign="center" vAlign="center">
    <canvas ref={ring} className="wave-ring-bars" width={192} height={192} aria-hidden="true" />
    {children}
  </HStack>;
}
