import { useEffect, useRef, type ReactNode } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { coverArt } from '../music/cover-art';
import { askGene } from '../music/song-cover';

// 同一作品总得到同一张唱片：风格、配色和每一笔都由作品 ID 派生。
export function random(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// 封套和唱片标签的图案：和播放页、yovoice 社区页同一套画法（见 music/cover-art.ts），
// 按版本编号、时长和响度起伏画出来；同一首歌在作品列表、播放页和社区页上是同一张封面。
export type CoverSource = { id: string; duration?: number; gene?: string };

// 每张图案解码一次，封套、标签和磁带标签共用；纸张颗粒最后统一叠上。
const arts = new Map<string, Promise<HTMLCanvasElement>>();
export function coverCanvas(source: CoverSource, size: number) {
  const key = `${source.id}:${Math.round(source.duration ?? 0)}:${source.gene ?? ''}:${size}`;
  let canvas = arts.get(key);
  if (canvas) return canvas;
  canvas = (async () => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverArt(source.id, source.duration ?? 0, source.gene).svg)}`;
    await image.decode();
    const result = document.createElement('canvas'); result.width = result.height = size;
    const c = result.getContext('2d')!;
    c.drawImage(image, 0, 0, size, size);
    const grain = random(`${source.id}:grain`);
    for (let i = 0; i < size * size / 3; i++) { c.fillStyle = grain() > .5 ? 'rgb(255 255 255 / 7%)' : 'rgb(0 0 0 / 7%)'; c.fillRect(grain() * size, grain() * size, 1, 1); }
    return result;
  })();
  if (arts.size > 200) arts.clear();
  arts.set(key, canvas);
  return canvas;
}

export async function drawRecord(canvas: HTMLCanvasElement, seed: string, label: boolean, cover: CoverSource = { id: seed }) {
  const source = label ? await coverCanvas(cover, 320).catch(() => null) : null;
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
  if (!source) return;
  // 标签印整张封面图案，图形的重心偏上，往下挪一点放到正中；中心是轴孔。
  const lr = r * .36;
  c.save(); c.beginPath(); c.arc(x, y, lr, 0, Math.PI * 2); c.clip();
  c.drawImage(source, x - lr * 1.1, y - lr * .95, lr * 2.2, lr * 2.2);
  c.restore();
  c.beginPath(); c.arc(x, y, lr, 0, Math.PI * 2); c.strokeStyle = 'rgb(0 0 0 / 35%)'; c.lineWidth = 1; c.stroke();
  c.beginPath(); c.arc(x, y, Math.max(2, r * .045), 0, Math.PI * 2); c.fillStyle = '#0B0B0C'; c.fill();
}

// 封套：和社区页的封套同一种版式——图案铺满，右上角印编号，左下角是标题和转速，
// 字底下垫一层封面的底色，图案再花也看得清；最后压一道从右上方来的光。
async function drawSleeve(canvas: HTMLCanvasElement, seed: string, title: string, cover: CoverSource) {
  const source = await coverCanvas(cover, canvas.width).catch(() => null);
  const c = canvas.getContext('2d');
  if (!c || !source) return;
  const s = canvas.width, m = s * .07, { paper, ink } = coverArt(cover.id, cover.duration ?? 0, cover.gene);
  c.clearRect(0, 0, s, s);
  c.drawImage(source, 0, 0);
  const font = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif', mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  const fade = c.createLinearGradient(0, s * .55, 0, s);
  const tint = (alpha: number) => paper.replace(')', ` / ${alpha})`);
  fade.addColorStop(0, tint(0)); fade.addColorStop(.55, tint(.8)); fade.addColorStop(1, paper);
  c.fillStyle = fade; c.fillRect(0, s * .55, s, s * .45);
  c.fillStyle = ink; c.textBaseline = 'alphabetic';
  c.font = `500 ${s * .042}px ${mono}`; c.globalAlpha = .55;
  const serial = `YV-${String(Math.floor(random(`${seed}:serial`)() * 0xfffff).toString(16).toUpperCase()).padStart(5, '0')}`;
  c.fillText(serial, s - m - c.measureText(serial).width, m + s * .03);
  c.fillText('33⅓ RPM', m, s - m);
  c.globalAlpha = 1;
  c.font = `700 ${s * .1}px ${font}`;
  let text = title.trim();
  if (c.measureText(text).width > s - m * 2) {
    while (text.length > 1 && c.measureText(`${text}…`).width > s - m * 2) text = text.slice(0, -1);
    text = `${text}…`;
  }
  c.fillText(text, m, s - m - s * .075);
  const light = c.createLinearGradient(s, 0, 0, s);
  light.addColorStop(0, 'rgb(255 255 255 / 19%)'); light.addColorStop(.38, 'rgb(255 255 255 / 0%)'); light.addColorStop(.62, 'rgb(0 0 0 / 0%)'); light.addColorStop(1, 'rgb(0 0 0 / 28%)');
  c.fillStyle = light; c.fillRect(0, 0, s, s);
}

// 作品封面：歌曲、编曲和故事是随机图案的封套，唱片从封套里探出一截，悬停时滑出并转动；
// 故事在封套上叠出场角色的头像。传入 children 时不画封套，直接做成以 children 为标签的黑胶唱片，
// 角色库用它把试听头像放在唱片中心，播放时唱片转动。
// cover 是画图案用的版本（编号、时长、响度起伏），作品列表传最近一版，这样和播放页的封面一致；不传时按 seed 画。
export function RecordCover({ seed, title = '', cover, cast, interactive = false, children }: { seed: string; title?: string; cover?: CoverSource; cast?: ReactNode; interactive?: boolean; children?: ReactNode }) {
  const disc = useRef<HTMLCanvasElement>(null);
  const sleeve = useRef<HTMLCanvasElement>(null);
  const label = !children;
  const art: CoverSource = cover ?? { id: seed };
  const { id, duration, gene } = art, song = !!cover;
  useEffect(() => {
    const source = { id, duration, gene };
    // 传了版本进来就是一首真实的歌：还没算响度起伏时请后端算，算好后版本更新、封面重画。
    if (song && duration !== undefined) askGene({ id, duration, gene });
    if (disc.current) void drawRecord(disc.current, seed, label, source);
    if (sleeve.current) void drawSleeve(sleeve.current, seed, title, source);
  }, [seed, label, title, id, duration, gene, song]);
  return <HStack className="record-cover" gap={0} vAlign="center" aria-hidden={interactive ? undefined : true} data-sleeve={label}>
    <canvas ref={disc} className="record-disc" width={192} height={192} />
    {label ? <canvas ref={sleeve} className="record-sleeve" width={320} height={320} /> : <HStack className="record-label" gap={0} hAlign="center" vAlign="center">{children}</HStack>}
    {label && cast ? <HStack className="record-cast" data-band="bottom" gap={0} vAlign="center">{cast}</HStack> : null}
  </HStack>;
}
