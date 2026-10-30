import { clamp } from '../shared/lib/math';
// 首次启动开场的粒子动画：粒子从远处汇成随“声音”起伏的 3D 球体，再聚成应用图标里的五根声波条。
// 纯 2D canvas 透视投影，不依赖 WebGL；时间单位为秒。

const count = 1500;
const radius = 150;
const bars = [[-2, 0.42], [-1, 0.7], [0, 1], [1, 0.66], [2, 0.46]] as const; // [横向位置, 相对高度]
// 声波条完全成形、开始呼吸的时刻，组件据此安排文字出现。
const barsFormedAt = 4.6;

type Particle = { sx: number; sy: number; sz: number; lat: number; lon: number; bx: number; by: number; bz: number; bar: number; delay: number; size: number };

const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function particles(): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    // 斐波那契球面分布，粒子在球面上均匀铺开。
    const k = i + .5, lat = Math.acos(1 - 2 * k / count), lon = Math.PI * (1 + Math.sqrt(5)) * k;
    const [column, height] = bars[i % 5];
    return {
      sx: (Math.random() - .5) * 2400, sy: (Math.random() - .5) * 1600, sz: 600 + Math.random() * 1800,
      lat, lon,
      bx: column * 34 + (Math.random() - .5) * 14, by: (Math.random() - .5) * 184 * height, bz: (Math.random() - .5) * 18, bar: i % 5,
      delay: Math.random() * .35, size: .7 + Math.random() * 1.3,
    };
  });
}

/** 在 canvas 上播放粒子动画；reduced 时直接画出最终的声波条。返回停止函数。 */
export function playParticles(canvas: HTMLCanvasElement, reduced: boolean): () => void {
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const points = particles();
  let width = 0, height = 0, frame = 0;
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth; height = canvas.clientHeight;
    canvas.width = width * ratio; canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
  const start = performance.now();
  const draw = (now: number) => {
    const t = reduced ? 9 : (now - start) / 1000;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';
    const cx = width / 2, cy = height * .38;
    const spin = t * .55 * (1 - ease(clamp((t - 3.2) / 1.6)));   // 收拢成声波条时停止旋转
    const voice = Math.sin(t * 2.2) * .5 + .5;                    // 像说话一样起伏的包络
    for (const p of points) {
      const gather = ease(clamp((t - p.delay) / 1.3));            // 散落 → 球体
      const form = ease(clamp((t - 3.1 - p.delay) / 1.5));         // 球体 → 声波条
      const wave = 1 + .16 * voice * Math.sin(p.lat * 7 + t * 6) * (1 - form);
      let x = radius * wave * Math.sin(p.lat) * Math.cos(p.lon), y = radius * wave * Math.cos(p.lat), z = radius * wave * Math.sin(p.lat) * Math.sin(p.lon);
      [x, z] = [x * Math.cos(spin) - z * Math.sin(spin), x * Math.sin(spin) + z * Math.cos(spin)];
      const tilt = .35 * (1 - form);
      [y, z] = [y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)];
      const breathe = 1 - .28 * (Math.sin(t * 3 - p.bar * .7) * .5 + .5) * clamp(t - barsFormedAt);
      const X = p.sx + (x - p.sx) * gather + (p.bx - x) * form;
      const Y = p.sy + (y - p.sy) * gather + (p.by * breathe - y) * form;
      const Z = p.sz + (z - p.sz) * gather + (p.bz - z) * form;
      const scale = 700 / (700 + Z);
      if (scale <= 0) continue;
      const depth = clamp((Z + radius) / (2 * radius));             // 0 最近，1 最远
      const alpha = clamp(gather * 1.2) * (.25 + .75 * (1 - depth));
      context.fillStyle = depth < .45 ? `rgba(246, 241, 233, ${alpha})` : `rgba(25, 195, 205, ${alpha * .9})`;
      context.beginPath();
      context.arc(cx + X * scale, cy + Y * scale, p.size * scale * (1 + .6 * form), 0, Math.PI * 2);
      context.fill();
    }
    if (!reduced) frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); };
}
