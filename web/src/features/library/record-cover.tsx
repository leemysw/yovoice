import { useEffect, useRef, type ReactNode } from 'react';
import { HStack } from '@astryxdesign/core/Layout';

// 同一作品总得到同一张唱片：风格、配色和每一笔都由作品 ID 派生。
function random(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// 配色参考印刷品与唱片封套：一个底色加几种油墨，彼此协调而不是一味高饱和。
interface Palette { paper: string; inks: string[] }
const palettes: Palette[] = [
  { paper: '#F3EEE3', inks: ['#FF48B0', '#0078BF', '#FFE800'] }, // 孔版印刷：荧光粉、蓝、黄
  { paper: '#EFE6D8', inks: ['#D9481C', '#1E3D8F', '#F2B134', '#2E2A27'] }, // 马蒂斯剪纸
  { paper: '#14142B', inks: ['#693668', '#A74482', '#F84AA7', '#FFB86B'] }, // 黄昏
  { paper: '#0F2027', inks: ['#2C5364', '#8FB8A8', '#EDE6D6', '#E07A5F'] }, // 北欧冬日
  { paper: '#FAEDCD', inks: ['#1F2A24', '#3C6E47', '#D4A373', '#BC4749'] }, // 森林
  { paper: '#F4F1EA', inks: ['#111111', '#E4572E', '#8A8A8A'] }, // 黑墨加一点朱红
  { paper: '#03045E', inks: ['#0077B6', '#00B4D8', '#90E0EF', '#FFD6A5'] }, // 深海
  { paper: '#FFF4E0', inks: ['#FB5607', '#FF006E', '#8338EC', '#3A86FF'] }, // 柑橘与电光
  { paper: '#1A1A1A', inks: ['#E9D8A6', '#EE9B00', '#CA6702', '#9B2226'] }, // 爵士唱片
  { paper: '#E8EDDF', inks: ['#242423', '#F5CB5C', '#CFDBD5', '#6A994E'] }, // 包豪斯
];

// 平滑的伪噪声场：几组随机方向和频率的正弦叠加，值域约 -1..1。
function field(next: () => number, waves = 4) {
  const terms = Array.from({ length: waves }, () => ({ a: (next() - .5) * 9, b: (next() - .5) * 9, p: next() * Math.PI * 2, w: .5 + next() }));
  const total = terms.reduce((sum, t) => sum + t.w, 0);
  return (x: number, y: number) => terms.reduce((sum, t) => sum + Math.sin(t.a * x + t.b * y + t.p) * t.w, 0) / total;
}

type Style = (c: CanvasRenderingContext2D, s: number, p: Palette, next: () => number) => void;

const styles: Style[] = [
  // 地形等高线：色带之间描细线，像一张彩色地形图。
  (c, s, p, next) => {
    const f = field(next, 5), bands = 6 + Math.floor(next() * 6), colors = [p.paper, ...p.inks].map(hexRGB);
    const image = c.createImageData(s, s);
    for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
      const v = (f(px / s, py / s) + 1) / 2 * bands, band = Math.floor(v), edge = v - band < .07;
      const [r, g, b] = edge ? colors[colors.length - 1] : colors[band % (colors.length - 1)];
      const i = (py * s + px) * 4; image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
    }
    c.putImageData(image, 0, 0);
  },
  // 流场：几百条细线顺着噪声场流动，像风或水的轨迹。
  (c, s, p, next) => {
    c.fillStyle = p.paper; c.fillRect(0, 0, s, s);
    const f = field(next, 3), turn = 2 + next() * 3;
    c.lineCap = 'round';
    for (let i = 0; i < 420; i++) {
      let x = next() * s, y = next() * s;
      c.beginPath(); c.moveTo(x, y);
      for (let step = 0; step < 36; step++) { const a = f(x / s, y / s) * Math.PI * turn; x += Math.cos(a) * s / 90; y += Math.sin(a) * s / 90; c.lineTo(x, y); }
      c.strokeStyle = p.inks[i % p.inks.length]; c.globalAlpha = .35 + next() * .5; c.lineWidth = s / 260 + next() * s / 180; c.stroke();
    }
    c.globalAlpha = 1;
  },
  // 柔光渐变：几团纯色先叠好再整体模糊，颜色彼此晕开而不发灰，中间留一道细细的地平线。
  (c, s, p, next) => {
    c.fillStyle = p.paper; c.fillRect(0, 0, s, s);
    c.filter = `blur(${Math.round(s / 7)}px)`;
    for (const ink of p.inks.slice(0, 3)) {
      c.beginPath(); c.ellipse(next() * s, next() * s, s * (.25 + next() * .3), s * (.2 + next() * .3), next() * Math.PI, 0, Math.PI * 2);
      c.fillStyle = ink; c.fill();
    }
    c.filter = 'none';
    c.globalAlpha = .6; c.fillStyle = p.paper; c.fillRect(0, Math.round(s * (.55 + next() * .3)), s, Math.max(1, s / 160)); c.globalAlpha = 1;
  },
  // 丝网半调：两种油墨的网点各自成形，叠印处变深，略微错版。
  (c, s, p, next) => {
    c.fillStyle = p.paper; c.fillRect(0, 0, s, s);
    // 深色底上改用滤色叠印，网点才看得见。
    c.globalCompositeOperation = luminance(p.paper) < .4 ? 'screen' : 'multiply';
    for (let layer = 0; layer < 2; layer++) {
      const cx = (.25 + next() * .5) * s, cy = (.25 + next() * .5) * s, radius = s * (.3 + next() * .35), angle = (layer ? 45 : 15) * Math.PI / 180, cell = s / 34;
      const shift = (next() - .5) * s / 40;
      c.fillStyle = p.inks[layer % p.inks.length];
      c.save(); c.translate(s / 2, s / 2); c.rotate(angle);
      for (let gx = -s; gx < s; gx += cell) for (let gy = -s; gy < s; gy += cell) {
        // 网点坐标转回画布坐标，按到中心的距离决定网点大小。
        const x = gx * Math.cos(angle) - gy * Math.sin(angle) + s / 2, y = gx * Math.sin(angle) + gy * Math.cos(angle) + s / 2;
        const d = Math.hypot(x - cx, y - cy) / radius, size = Math.max(0, 1 - d) * cell * .62 + (layer ? 0 : (y / s) * cell * .18);
        if (size > .3) { c.beginPath(); c.arc(gx + shift, gy + shift, size, 0, Math.PI * 2); c.fill(); }
      }
      c.restore();
    }
    c.globalCompositeOperation = 'source-over';
  },
  // 欧普波纹：两色条纹被正弦扭曲，像七十年代的唱片封套。
  (c, s, p, next) => {
    const [a, b] = [p.inks[0], next() > .5 ? p.paper : p.inks[1]], bands = 14 + Math.floor(next() * 12);
    const amp = s * (.03 + next() * .08), freq = 1 + next() * 3, twist = next() * 4, vertical = next() > .5;
    c.fillStyle = b; c.fillRect(0, 0, s, s); c.fillStyle = a;
    c.save(); if (vertical) { c.translate(s, 0); c.rotate(Math.PI / 2); }
    for (let i = -2; i < bands + 2; i += 2) {
      const top = (y0: number) => (x: number) => y0 + Math.sin(x / s * Math.PI * 2 * freq + y0 / s * twist) * amp;
      const t = top(i * s / bands), u = top((i + 1) * s / bands);
      c.beginPath(); c.moveTo(0, t(0));
      for (let x = 0; x <= s; x += 3) c.lineTo(x, t(x));
      for (let x = s; x >= 0; x -= 3) c.lineTo(x, u(x));
      c.closePath(); c.fill();
    }
    c.restore();
  },
  // 瑞士构成：网格上一枚大圆、一块色面、几条细线和一个小点。
  (c, s, p, next) => {
    c.fillStyle = p.paper; c.fillRect(0, 0, s, s);
    const grid = s / 6, pick = () => Math.floor(next() * 6) * grid;
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = p.inks[1 % p.inks.length]; c.fillRect(pick(), pick(), grid * (2 + Math.floor(next() * 3)), grid * (1 + Math.floor(next() * 4)));
    c.beginPath(); c.arc(grid * (2 + next() * 2), grid * (2 + next() * 2), grid * (1.6 + next() * 1.2), 0, Math.PI * 2); c.fillStyle = p.inks[0]; c.fill();
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = p.inks[p.inks.length - 1]; c.lineWidth = Math.max(1, s / 200);
    for (let i = 0; i < 3 + Math.floor(next() * 4); i++) { const y = pick() + grid / 2; c.beginPath(); c.moveTo(next() * grid, y); c.lineTo(s - next() * grid * 2, y); c.stroke(); }
    c.beginPath(); c.arc(pick() + grid / 2, pick() + grid / 2, grid * .22, 0, Math.PI * 2); c.fillStyle = p.inks[2 % p.inks.length]; c.fill();
  },
];

function hexRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

function luminance(hex: string) {
  const [r, g, b] = hexRGB(hex);
  return (r * .299 + g * .587 + b * .114) / 255;
}

// 每个作品画一次，封套和唱片标签共用；纸张颗粒最后统一叠上。
const arts = new Map<string, HTMLCanvasElement>();
function art(seed: string, size: number) {
  const key = `${seed}:${size}`;
  let canvas = arts.get(key);
  if (canvas) return canvas;
  canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!, next = random(`${seed}:art`);
  const palette = palettes[Math.floor(next() * palettes.length)];
  styles[Math.floor(next() * styles.length)](c, size, { paper: palette.paper, inks: palette.inks.slice().sort(() => next() - .5) }, next);
  const grain = random(`${seed}:grain`);
  for (let i = 0; i < size * size / 3; i++) { c.fillStyle = grain() > .5 ? 'rgb(255 255 255 / 9%)' : 'rgb(0 0 0 / 9%)'; c.fillRect(grain() * size, grain() * size, 1, 1); }
  if (arts.size > 200) arts.clear();
  arts.set(key, canvas);
  return canvas;
}

export function drawRecord(canvas: HTMLCanvasElement, seed: string, label: boolean) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const { width } = canvas, x = width / 2, y = width / 2, r = width / 2 - 1;
  const next = random(`${seed}:grooves`), inner = r * .42, outer = r * .955;
  c.clearRect(0, 0, width, width);
  // 盘面：中心略亮的黑，边缘一圈光滑的唇边。
  const base = c.createRadialGradient(x, y, 0, x, y, r);
  base.addColorStop(0, '#1C1C1E'); base.addColorStop(.7, '#121213'); base.addColorStop(1, '#0B0B0C');
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = base; c.fill();
  // 曲目之间的空白带：比音槽更平滑、更亮一点，每张唱片的位置和数量不同。
  const gaps = Array.from({ length: 3 + Math.floor(next() * 4) }, () => inner + (outer - inner) * (.12 + next() * .8)).sort((a, b) => a - b);
  // 音槽：逐圈描极细的环，明暗随机起伏，空白带附近留出平面。
  for (let ring = inner; ring < outer; ring += .55) {
    if (gaps.some(g => Math.abs(ring - g) < width / 140)) continue;
    c.beginPath(); c.arc(x, y, ring, 0, Math.PI * 2);
    c.strokeStyle = next() > .5 ? `rgb(255 255 255 / ${2 + next() * 5}%)` : `rgb(0 0 0 / ${20 + next() * 30}%)`;
    c.lineWidth = .45; c.stroke();
  }
  for (const g of gaps) { c.beginPath(); c.arc(x, y, g, 0, Math.PI * 2); c.strokeStyle = 'rgb(255 255 255 / 7%)'; c.lineWidth = width / 140; c.stroke(); }
  // 引入槽与收尾槽：外缘一道亮线，标签外一圈平滑的出槽区。
  c.beginPath(); c.arc(x, y, outer + .5, 0, Math.PI * 2); c.strokeStyle = 'rgb(255 255 255 / 14%)'; c.lineWidth = .8; c.stroke();
  c.beginPath(); c.arc(x, y, inner, 0, Math.PI * 2); c.strokeStyle = 'rgb(255 255 255 / 12%)'; c.lineWidth = .8; c.stroke();
  // 音槽反光：两道对称的扇形高光，中间亮两侧渐隐，带一点暖色。
  const sheen = c.createConicGradient(-Math.PI / 4 + (next() - .5) * .6, x, y);
  for (const offset of [0, .5]) {
    sheen.addColorStop(offset, 'rgb(255 255 255 / 0%)');
    sheen.addColorStop(offset + .06, 'rgb(255 248 235 / 22%)');
    sheen.addColorStop(offset + .09, 'rgb(255 255 255 / 30%)');
    sheen.addColorStop(offset + .13, 'rgb(235 240 255 / 14%)');
    sheen.addColorStop(offset + .22, 'rgb(255 255 255 / 0%)');
  }
  c.save(); c.beginPath(); c.arc(x, y, outer, 0, Math.PI * 2); c.arc(x, y, inner, 0, Math.PI * 2, true); c.clip('evenodd');
  c.globalCompositeOperation = 'screen'; c.fillStyle = sheen; c.fillRect(0, 0, width, width); c.restore();
  if (!label) return;
  // 标签取封套画面的中心部分，中心是轴孔。
  const lr = r * .36, source = art(seed, 320);
  c.save(); c.beginPath(); c.arc(x, y, lr, 0, Math.PI * 2); c.clip();
  c.drawImage(source, source.width * .3, source.height * .3, source.width * .4, source.height * .4, x - lr, y - lr, lr * 2, lr * 2);
  c.restore();
  c.beginPath(); c.arc(x, y, lr, 0, Math.PI * 2); c.strokeStyle = 'rgb(0 0 0 / 35%)'; c.lineWidth = 1; c.stroke();
  c.beginPath(); c.arc(x, y, Math.max(2, r * .045), 0, Math.PI * 2); c.fillStyle = '#0B0B0C'; c.fill();
}

// 封套：在图案上叠印刷信息和使用痕迹，让它像一张真实的唱片封面而不只是一张图。
function drawSleeve(canvas: HTMLCanvasElement, seed: string, title: string) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const s = canvas.width, next = random(`${seed}:sleeve`), m = s * .07;
  c.drawImage(art(seed, s), 0, 0);
  const font = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif';
  // 印刷信息条：顶部或底部一条实色带，左侧粗体标题，下面一行厂牌编号和转速，像老唱片的版式。
  const top = next() > .5, dark = next() > .5, band = s * .25;
  const [paper, ink] = dark ? ['#141414', '#F4F1EA'] : ['#F4F1EA', '#141414'];
  const y0 = top ? 0 : s - band;
  c.fillStyle = paper; c.fillRect(0, y0, s, band);
  const size = s * .1;
  c.font = `700 ${size}px ${font}`; c.textBaseline = 'alphabetic'; c.fillStyle = ink;
  let text = title.trim();
  if (c.measureText(text).width > s - m * 2) {
    while (text.length > 1 && c.measureText(`${text}…`).width > s - m * 2) text = text.slice(0, -1);
    text = `${text}…`;
  }
  c.fillText(text, m, y0 + band * .52);
  const small = s * .042;
  c.font = `500 ${small}px ${font}`; c.globalAlpha = .65;
  const speed = '33⅓ RPM';
  c.fillText(`YV-${String(Math.floor(next() * 900) + 100)}`, m, y0 + band * .8);
  c.fillText(speed, s - m - c.measureText(speed).width, y0 + band * .8);
  c.globalAlpha = 1;
  // 圆形磨痕：里面那张唱片长年压出的一圈浅色印子，只是若隐若现的一段弧。
  c.save(); c.globalCompositeOperation = 'screen';
  const start = next() * Math.PI * 2;
  for (let i = 0; i < 260; i++) {
    const a = start + next() * Math.PI * 1.3, rr = s * (.44 + (next() - .5) * .025);
    c.fillStyle = `rgb(255 255 255 / ${4 + next() * 8}%)`; c.fillRect(s / 2 + Math.cos(a) * rr, s / 2 + Math.sin(a) * rr, 1.2, 1.2);
  }
  // 边角磨损：沿四边随机擦出浅色毛边。
  for (let i = 0; i < 160; i++) {
    const t = next() * s, d = next() ** 3 * s * .03, side = Math.floor(next() * 4);
    const [x, y] = side === 0 ? [t, d] : side === 1 ? [s - d, t] : side === 2 ? [t, s - d] : [d, t];
    c.fillStyle = `rgb(255 255 255 / ${8 + next() * 14}%)`; c.fillRect(x, y, 1 + next() * 1.5, 1 + next() * 1.5);
  }
  c.restore();
  // 覆膜反光与封口阴影：左上一道斜向柔光，右侧开口处略暗。
  const gloss = c.createLinearGradient(0, 0, s, s);
  gloss.addColorStop(0, 'rgb(255 255 255 / 0%)'); gloss.addColorStop(.32, 'rgb(255 255 255 / 10%)'); gloss.addColorStop(.42, 'rgb(255 255 255 / 0%)');
  c.fillStyle = gloss; c.fillRect(0, 0, s, s);
  const edge = c.createLinearGradient(s * .9, 0, s, 0);
  edge.addColorStop(0, 'rgb(0 0 0 / 0%)'); edge.addColorStop(1, 'rgb(0 0 0 / 22%)');
  c.fillStyle = edge; c.fillRect(0, 0, s, s);
}

// 作品封面：歌曲和编曲是随机图案的封套，唱片从封套里探出一截，悬停时滑出并转动；
// 传入 children 时不画封套，直接做成以头像为标签的黑胶唱片。
export function RecordCover({ seed, title = '', children }: { seed: string; title?: string; children?: ReactNode }) {
  const disc = useRef<HTMLCanvasElement>(null);
  const sleeve = useRef<HTMLCanvasElement>(null);
  const label = !children;
  useEffect(() => {
    if (disc.current) drawRecord(disc.current, seed, label);
    if (sleeve.current) drawSleeve(sleeve.current, seed, title);
  }, [seed, label, title]);
  return <HStack className="record-cover" gap={0} vAlign="center" aria-hidden="true" data-sleeve={label}>
    <canvas ref={disc} className="record-disc" width={192} height={192} />
    {label ? <canvas ref={sleeve} className="record-sleeve" width={320} height={320} /> : <HStack className="record-label" gap={0} hAlign="center" vAlign="center">{children}</HStack>}
  </HStack>;
}
