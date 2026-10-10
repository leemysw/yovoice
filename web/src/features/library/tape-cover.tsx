import { useEffect, useRef } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { art, random } from './record-cover';

// 磁带外壳的几种常见塑料颜色；标签顶部那条色带取作品的随机图案。
const shells = ['#1C1C1E', '#E9E4D8', '#2F4858', '#B9472F', '#D9C3A0', '#6F8F7F', '#3A3F7A'];

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.roundRect(x, y, w, h, r);
}

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return `rgb(${f(n >> 16 & 255)} ${f(n >> 8 & 255)} ${f(n & 255)})`;
}

// 画布尺寸 360×240，与封面 3:2 的外框一致；两个卷轴中心在 (128,125) 和 (232,125)。
function drawTape(canvas: HTMLCanvasElement, seed: string, title: string) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const w = canvas.width, h = canvas.height, next = random(`${seed}:tape`);
  const shell = shells[Math.floor(next() * shells.length)], dark = parseInt(shell.slice(1, 3), 16) < 128;
  c.clearRect(0, 0, w, h);
  // 外壳：上亮下暗的塑料，边缘一道暗线。
  const body = c.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, shade(shell, .06)); body.addColorStop(1, shade(shell, -.06));
  roundRect(c, 1, 1, w - 2, h - 2, 16); c.fillStyle = body; c.fill();
  c.strokeStyle = 'rgb(0 0 0 / 25%)'; c.lineWidth = 2; c.stroke();
  // 标签：顶部一条随机图案色带，下面是写标题的纸面和几条书写线。
  c.save(); roundRect(c, 18, 16, w - 36, 146, 6); c.clip();
  c.fillStyle = '#F4F1EA'; c.fillRect(18, 16, w - 36, 146);
  const source = art(seed, 320);
  c.drawImage(source, 0, source.height * .4, source.width, source.height * .14, 18, 16, w - 36, 34);
  c.strokeStyle = 'rgb(20 20 20 / 12%)'; c.lineWidth = 1;
  for (const y of [86, 100]) { c.beginPath(); c.moveTo(30, y); c.lineTo(w - 30, y); c.stroke(); }
  const font = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif';
  c.fillStyle = '#141414'; c.font = `700 26px ${font}`; c.textBaseline = 'alphabetic';
  let text = title.trim();
  if (c.measureText(text).width > w - 100) {
    while (text.length > 1 && c.measureText(`${text}…`).width > w - 100) text = text.slice(0, -1);
    text = `${text}…`;
  }
  c.fillText(text, 30, 80);
  c.font = `800 22px ${font}`; c.fillText('A', w - 50, 80);
  c.restore();
  // 观察窗：深色半透明，里面能看到两卷磁带，一边多一边少。
  roundRect(c, 92, 104, 176, 44, 8); c.fillStyle = 'rgb(16 16 18 / 82%)'; c.fill();
  c.save(); roundRect(c, 92, 104, 176, 44, 8); c.clip();
  const wound = 20 + next() * 22;
  for (const [x, r] of [[128, wound], [232, 62 - wound]] as const) {
    c.beginPath(); c.arc(x, 125, r, 0, Math.PI * 2); c.fillStyle = '#3B2A20'; c.fill();
    c.strokeStyle = 'rgb(255 255 255 / 8%)'; c.lineWidth = 1; c.stroke();
  }
  c.restore();
  // 卷轴孔：外圈白色，中心留给可转动的齿轮。
  for (const x of [128, 232]) { c.beginPath(); c.arc(x, 125, 17, 0, Math.PI * 2); c.fillStyle = '#F4F1EA'; c.fill(); }
  // 底部梯形压板与定位孔。
  c.beginPath(); c.moveTo(64, h - 2); c.lineTo(86, 182); c.lineTo(w - 86, 182); c.lineTo(w - 64, h - 2); c.closePath();
  c.fillStyle = shade(shell, dark ? .08 : -.08); c.fill();
  for (const x of [120, w - 120]) { c.beginPath(); c.arc(x, 212, 7, 0, Math.PI * 2); c.fillStyle = 'rgb(0 0 0 / 55%)'; c.fill(); }
  for (const x of [156, w - 168]) { c.fillStyle = 'rgb(0 0 0 / 40%)'; c.fillRect(x, 206, 12, 12); }
  // 四角螺丝。
  for (const [x, y] of [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]]) {
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fillStyle = shade(shell, dark ? .25 : -.3); c.fill();
    c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + 3, y); c.strokeStyle = 'rgb(0 0 0 / 45%)'; c.lineWidth = 1.2; c.stroke();
  }
  // 塑料反光与颗粒。
  const gloss = c.createLinearGradient(0, 0, w, h);
  gloss.addColorStop(0, 'rgb(255 255 255 / 0%)'); gloss.addColorStop(.35, 'rgb(255 255 255 / 10%)'); gloss.addColorStop(.45, 'rgb(255 255 255 / 0%)');
  roundRect(c, 1, 1, w - 2, h - 2, 16); c.fillStyle = gloss; c.fill();
}

// 卷轴齿轮：白色内圈加六个齿，单独一张画布，悬停时转动。
function drawHub(canvas: HTMLCanvasElement) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const s = canvas.width, x = s / 2;
  c.clearRect(0, 0, s, s);
  c.beginPath(); c.arc(x, x, s * .3, 0, Math.PI * 2); c.fillStyle = '#2A2A2C'; c.fill();
  c.fillStyle = '#F4F1EA';
  for (let i = 0; i < 6; i++) {
    c.save(); c.translate(x, x); c.rotate(i * Math.PI / 3); c.fillRect(-s * .04, -s * .3, s * .08, s * .12); c.restore();
  }
}

// 语音作品的封面：一盒磁带，标签上写着作品名，悬停时两个卷轴转起来。
export function TapeCover({ seed, title }: { seed: string; title: string }) {
  const body = useRef<HTMLCanvasElement>(null);
  const hubs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    if (body.current) drawTape(body.current, seed, title);
    hubs.current.forEach(hub => { if (hub) drawHub(hub); });
  }, [seed, title]);
  return <HStack className="tape-cover" gap={0} aria-hidden="true">
    <canvas ref={body} className="tape-body" width={360} height={240} />
    {[0, 1].map(i => <canvas key={i} ref={el => { hubs.current[i] = el; }} className="tape-hub" data-side={i ? 'right' : 'left'} width={64} height={64} />)}
  </HStack>;
}
