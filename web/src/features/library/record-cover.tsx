import { useEffect, useRef, type ReactNode } from 'react';
import { HStack } from '@astryxdesign/core/Layout';

// 同一作品总得到同一张唱片：配色、图案和纹路都由作品 ID 派生。
function random(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// 唱片标签的配色组：饱和、对比强，一张唱片取一组。
const palettes = [
  ['#F25C2A', '#F7C548', '#2E86AB', '#F4EBD9'],
  ['#E63946', '#F1FAEE', '#A8DADC', '#1D3557'],
  ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF'],
  ['#7B2CBF', '#E0AAFF', '#FF9E00', '#240046'],
  ['#06D6A0', '#118AB2', '#FFD166', '#EF476F'],
  ['#FF4D6D', '#FFB3C1', '#590D22', '#FFF0F3'],
  ['#2A9D8F', '#E9C46A', '#F4A261', '#264653'],
  ['#FB5607', '#FFBE0B', '#3A86FF', '#8338EC'],
];

type Pattern = (c: CanvasRenderingContext2D, x: number, y: number, r: number, colors: string[], next: () => number) => void;

const patterns: Pattern[] = [
  // 同心色环
  (c, x, y, r, colors, next) => {
    const rings = 3 + Math.floor(next() * 4);
    for (let i = rings; i > 0; i--) { c.beginPath(); c.arc(x, y, r * i / rings, 0, Math.PI * 2); c.fillStyle = colors[i % colors.length]; c.fill(); }
  },
  // 放射扇面
  (c, x, y, r, colors, next) => {
    const slices = 6 + Math.floor(next() * 10), turn = next() * Math.PI;
    for (let i = 0; i < slices; i++) {
      c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, turn + i / slices * Math.PI * 2, turn + (i + 1) / slices * Math.PI * 2); c.closePath();
      c.fillStyle = colors[i % 2 === 0 ? 0 : 1 + (i >> 1) % (colors.length - 1)]; c.fill();
    }
  },
  // 叠在一起的圆点
  (c, x, y, r, colors, next) => {
    c.fillStyle = colors[3]; c.fillRect(x - r, y - r, r * 2, r * 2);
    for (let i = 0; i < 4 + Math.floor(next() * 4); i++) {
      c.beginPath(); c.arc(x + (next() - .5) * r * 1.6, y + (next() - .5) * r * 1.6, r * (.2 + next() * .5), 0, Math.PI * 2);
      c.fillStyle = colors[i % 3]; c.globalAlpha = .85; c.fill(); c.globalAlpha = 1;
    }
  },
  // 斜条纹
  (c, x, y, r, colors, next) => {
    const width = r * (.18 + next() * .2), angle = next() * Math.PI;
    c.save(); c.translate(x, y); c.rotate(angle);
    for (let i = -6; i <= 6; i++) { c.fillStyle = colors[(i + 12) % colors.length]; c.fillRect(i * width - width / 2, -r * 1.5, width, r * 3); }
    c.restore();
  },
  // 包豪斯式半圆拼贴
  (c, x, y, r, colors, next) => {
    const turn = Math.floor(next() * 4) * Math.PI / 2;
    c.fillStyle = colors[0]; c.fillRect(x - r, y - r, r * 2, r * 2);
    c.beginPath(); c.arc(x, y, r, turn, turn + Math.PI); c.fillStyle = colors[1]; c.fill();
    c.beginPath(); c.arc(x + Math.cos(turn) * r * .5, y + Math.sin(turn) * r * .5, r * .5, turn + Math.PI, turn + Math.PI * 2); c.fillStyle = colors[2]; c.fill();
    c.beginPath(); c.arc(x - Math.cos(turn) * r * .45, y - Math.sin(turn) * r * .45, r * .22, 0, Math.PI * 2); c.fillStyle = colors[3]; c.fill();
  },
];

// 同一种子总画出同一幅图：封套和唱片标签共用这一幅。
function drawArt(c: CanvasRenderingContext2D, x: number, y: number, r: number, seed: string) {
  const next = random(`${seed}:art`);
  const colors = palettes[Math.floor(next() * palettes.length)].slice().sort(() => next() - .5);
  c.fillStyle = colors[0]; c.fillRect(x - r, y - r, r * 2, r * 2);
  patterns[Math.floor(next() * patterns.length)](c, x, y, r, colors, next);
  const grain = random(`${seed}:grain`), area = r * 2;
  for (let i = 0; i < area * area / 4; i++) { c.fillStyle = grain() > .5 ? 'rgb(255 255 255 / 10%)' : 'rgb(0 0 0 / 10%)'; c.fillRect(x - r + grain() * area, y - r + grain() * area, 1, 1); }
}

export function drawRecord(canvas: HTMLCanvasElement, seed: string, label: boolean) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const { width } = canvas, x = width / 2, y = width / 2, r = width / 2 - 1;
  const next = random(`${seed}:grooves`);
  c.clearRect(0, 0, width, width);
  // 黑胶盘面与细密纹路。
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = '#141414'; c.fill();
  for (let ring = r * .4; ring < r * .97; ring += Math.max(1, width / 160)) {
    c.beginPath(); c.arc(x, y, ring, 0, Math.PI * 2);
    c.strokeStyle = `rgb(255 255 255 / ${3 + next() * 5}%)`; c.lineWidth = .6; c.stroke();
  }
  c.beginPath(); c.arc(x, y, r * .97, 0, Math.PI * 2); c.strokeStyle = 'rgb(255 255 255 / 10%)'; c.lineWidth = 1; c.stroke();
  if (!label) return;
  // 标签与封套同一幅图，中心是轴孔。
  const lr = r * .38;
  c.save(); c.beginPath(); c.arc(x, y, lr, 0, Math.PI * 2); c.clip();
  drawArt(c, x, y, lr, seed);
  c.restore();
  c.beginPath(); c.arc(x, y, Math.max(2, r * .045), 0, Math.PI * 2); c.fillStyle = '#141414'; c.fill();
}

function drawSleeve(canvas: HTMLCanvasElement, seed: string) {
  const c = canvas.getContext('2d');
  // 半径取到对角线，让同心环和扇面也铺满方形封套。
  if (c) drawArt(c, canvas.width / 2, canvas.height / 2, canvas.width * .72, seed);
}

// 作品封面：歌曲和编曲是随机图案的封套，唱片从封套里探出一截，悬停时滑出并转动；
// 传入 children 时不画封套，直接做成以头像为标签的黑胶唱片。
export function RecordCover({ seed, children }: { seed: string; children?: ReactNode }) {
  const disc = useRef<HTMLCanvasElement>(null);
  const sleeve = useRef<HTMLCanvasElement>(null);
  const label = !children;
  useEffect(() => {
    if (disc.current) drawRecord(disc.current, seed, label);
    if (sleeve.current) drawSleeve(sleeve.current, seed);
  }, [seed, label]);
  return <HStack className="record-cover" gap={0} vAlign="center" aria-hidden="true" data-sleeve={label}>
    <canvas ref={disc} className="record-disc" width={192} height={192} />
    {label ? <canvas ref={sleeve} className="record-sleeve" width={192} height={192} /> : <HStack className="record-label" gap={0} hAlign="center" vAlign="center">{children}</HStack>}
  </HStack>;
}
