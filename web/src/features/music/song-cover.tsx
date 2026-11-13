import { useEffect, useRef } from 'react';
import { call } from '../../shared/lib/client';
import type { Generation } from '../../shared/workbench';
import { coverArt } from './cover-art';

// 封面只看版本编号、时长和响度起伏，传整个版本进来方便取这几项。
type CoverSource = Pick<Generation, 'id' | 'duration' | 'gene'>;

// 封面的主色与对比色，播放页背景沿用同一组颜色。
export function coverPalette(item: CoverSource) {
  const { hue, accent } = coverArt(item.id, item.duration, item.gene);
  return { hue, accent };
}

// 响度起伏第一次要用时由后端算出来并随版本保存，算好后版本记录会带着它更新，封面跟着重画。
// 同一个版本只请求一次；还没算出来时先按身份画一张。
const asked = new Set<string>();
export function askGene(item: CoverSource) {
  if (item.gene || asked.has(item.id)) return;
  asked.add(item.id);
  void call('generation.gene', { id: item.id }).catch(() => undefined);
}

function coverImage(item: CoverSource) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverArt(item.id, item.duration, item.gene).svg)}`;
  return image.decode().then(() => image);
}

// 在画布上画封面：图案铺满，再压一层从右上方来的光和固定位置的颗粒，像印出来、被灯照着的封套。
function paint(canvas: HTMLCanvasElement, image: HTMLImageElement, seed: string) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.drawImage(image, 0, 0, width, height);
  const light = context.createLinearGradient(width, 0, 0, height);
  light.addColorStop(0, 'rgb(255 255 255 / 19%)'); light.addColorStop(0.38, 'rgb(255 255 255 / 0%)'); light.addColorStop(1, 'rgb(0 0 0 / 28%)');
  context.fillStyle = light; context.fillRect(0, 0, width, height);
  let state = 0;
  for (const char of `${seed}:grain`) state = (state * 31 + char.charCodeAt(0)) >>> 0;
  const grain = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296, dots = Math.floor(width * height / 40);
  for (let i = 0; i < dots; i++) {
    context.fillStyle = grain() > .5 ? 'rgb(255 255 255 / 6%)' : 'rgb(0 0 0 / 10%)';
    context.fillRect(Math.floor(grain() * width), Math.floor(grain() * height), 1, 1);
  }
}

export function SongCover({ item, size = 320 }: { item: CoverSource; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { id, duration, gene } = item;
  useEffect(() => {
    askGene({ id, duration, gene });
    let live = true;
    void coverImage({ id, duration, gene }).then(image => { if (live && canvas.current) paint(canvas.current, image, id); }).catch(() => undefined);
    return () => { live = false; };
  }, [id, duration, gene]);
  return <canvas ref={canvas} className="song-cover" width={size} height={size} aria-hidden="true" />;
}

// 导出时写进 FLAC / M4A 的封面：与播放页同一张图，JPEG 的 base64（不带 data: 前缀）。
export async function coverJpeg(item: CoverSource, size = 600): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas, await coverImage(item), item.id);
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1] ?? '';
}
