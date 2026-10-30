import { useEffect, useRef, type RefObject } from 'react';
import type { LyricLine } from './lyric-timing';
import { clamp } from '../../shared/lib/math';

// 浮光样式的逐字动效：一句一屏，字散落在画面中央，唱到时从远处飞入、放大发光，唱过后缩回原位并慢慢偏转、向外漂开。
// 每个字的位置、倾斜和大小由行号与字序派生，同一句每次显示都一样；动画逐帧写到元素样式上，不经过 React 渲染。

// 提前点亮的秒数：字在真正开始唱之前就开始飞入，视觉上正好落在拍子上。
const lookahead = 0.16;
// 唱过后偏转和外漂所用的秒数，以及颜色从强调色退回正文色的秒数。
const driftSeconds = 5, fadeSeconds = 0.8;
// 每帧向目标值逼近的速度：位移与缩放、透明度与模糊、光晕。
const moveRate = 11, fadeRate = 14, glowRate = 16;

// 由种子得到 0~1 的伪随机数。
const random = (seed: number) => { const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return value - Math.floor(value); };
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;
const easeInOut = (value: number) => value < .5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
// 粗估一个字的宽度（em）：中日韩全角一个字约 1em，其余字母约 .55em。
const width = (text: string) => [...text.trim()].reduce((sum, char) => sum + (/[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/u.test(char) ? 1 : .55), 0);

export interface GlyphLayout { x: number; y: number; rotate: number; scale: number; passedRotate: number; pad: number; hero: boolean }

// 一句的版式：每个字的散落偏移（em）、倾斜（度）、大小，以及给放大后的字留出的左右间距；较长的字靠近句中时成为主字，单独放大。
// fit 按字数缩小字号，align 决定这一句整体靠左、居中还是靠右。
export function phraseLayout(line: LyricLine, index: number) {
  const words = line.words ?? [];
  const seed = (k: number, salt: number) => random(index * 131 + k * 17 + salt);
  const graphemes = words.reduce((sum, word) => sum + [...word.text.trim()].length, 0);
  const scores = words.map((word, k) => Math.min([...word.text.trim()].length * .08, .36) + .18 * (1 - Math.abs(k / Math.max(1, words.length - 1) - .5) * 2));
  const best = scores.indexOf(Math.max(...scores));
  const heroIndex = words.length >= 3 && [...(words[best]?.text.trim() ?? '')].length >= 2 ? best : -1;
  const glyphs: GlyphLayout[] = words.map((word, k) => {
    const hero = k === heroIndex, scale = (1.1 + seed(k, 1) * .2) * (hero ? 1.46 : 1);
    return { x: (seed(k, 2) - .5) * .6, y: (seed(k, 3) - .5) * .6, rotate: (seed(k, 4) - .5) * 10, scale, passedRotate: (seed(k, 5) - .5) * 30, hero,
      pad: Math.max(.06, width(word.text) * (scale * 1.4 - 1) / 2 * .7 + .04) };
  });
  const fit = clamp(1 - Math.max(0, graphemes - 12) * .022 - Math.max(0, words.length - 7) * .02, .55, 1);
  const align = (['center', 'center', 'start', 'end'] as const)[Math.floor(random(index * 7 + 11) * 4)];
  return { glyphs, fit, align };
}

interface Motion { x: number; y: number; rotate: number; scale: number; opacity: number; blur: number; mix: number; glow: number }
// 当前句里每个字在 now 时刻应到的样子：waiting 未唱、active 正在唱、done 唱过。
function target(element: HTMLElement, now: number, level: number): Motion & { state: string } {
  const start = Number(element.dataset.wordStart), end = Number(element.dataset.wordEnd), duration = Math.max(.1, end - start);
  const x = Number(element.dataset.x), y = Number(element.dataset.y), rotate = Number(element.dataset.rotate), scale = Number(element.dataset.scale), turn = Number(element.dataset.turn);
  if (now < start - lookahead) return { state: 'waiting', x: x + Math.sin(y * 9) * 1.6, y: y + Math.cos(x * 9) * .8, rotate: rotate + 20, scale: .5, opacity: 0, blur: .16, mix: 0, glow: 0 };
  if (now < end) {
    const progress = clamp((now - start) / duration), pulse = 1 + Math.sin(now * 10 + start * 5) * .04;
    // 光晕先快速亮起，在这个字唱到三成时最亮，之后慢慢褪去，拖出一道尾光。
    const sweep = clamp((now - start + lookahead) / (duration * 1.6 + lookahead));
    const glow = sweep < .3 ? easeOutCubic(sweep / .3) : 1 - (sweep - .3) / .7 * .6;
    return { state: 'active', x, y, rotate, scale: scale * 1.4 * pulse * (1 + level * .05), opacity: 1, blur: 0, mix: progress, glow };
  }
  const after = now - end, drift = easeInOut(clamp(after / driftSeconds)), out = Math.hypot(x, y) || 1;
  return { state: 'done', x: x + x / out * drift * .12, y: y + y / out * drift * .12, rotate: rotate + turn * clamp(after / driftSeconds), scale, opacity: .82,
    blur: 0, mix: 1 - easeInOut(clamp(after / fadeSeconds)), glow: Math.max(0, .4 * (1 - after / .9)) ** 2 };
}

// 浮光样式开着时逐帧推动当前句的每个字；暂停时也继续运行，让字平稳停到位。减少动态效果时直接跳到目标状态。
export function useKineticLyrics(root: RefObject<HTMLElement | null>, audio: RefObject<HTMLAudioElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motions = new WeakMap<HTMLElement, Motion>();
    let frame = 0, last = performance.now();
    const tick = (stamp: number) => {
      const element = audio.current, box = root.current, dt = Math.min(.1, (stamp - last) / 1000);
      last = stamp;
      if (element && box) {
        const now = element.currentTime, level = Number(box.style.getPropertyValue('--now-playing-level')) || 0;
        const approach = (rate: number) => still ? 1 : 1 - Math.exp(-rate * dt);
        for (const glyph of box.querySelectorAll<HTMLElement>('.now-playing-phrase[data-slot="current"] .now-playing-glyph')) {
          const goal = target(glyph, now, level), motion = motions.get(glyph) ?? { ...goal };
          const move = approach(moveRate), fade = approach(fadeRate), shine = approach(glowRate);
          motion.x += (goal.x - motion.x) * move; motion.y += (goal.y - motion.y) * move; motion.rotate += (goal.rotate - motion.rotate) * move; motion.scale += (goal.scale - motion.scale) * move;
          motion.opacity += (goal.opacity - motion.opacity) * fade; motion.blur += (goal.blur - motion.blur) * fade; motion.mix += (goal.mix - motion.mix) * fade; motion.glow += (goal.glow - motion.glow) * shine;
          motions.set(glyph, motion);
          const bob = still ? 0 : Math.sin(now * 1.2 + Number(glyph.dataset.index) * .6) * .06 * level;
          glyph.style.transform = `translate(${motion.x.toFixed(3)}em, ${(motion.y + bob).toFixed(3)}em) rotate(${motion.rotate.toFixed(2)}deg) scale(${motion.scale.toFixed(3)})`;
          glyph.style.opacity = motion.opacity.toFixed(3);
          glyph.style.filter = motion.blur > .005 ? `blur(${motion.blur.toFixed(3)}em)` : '';
          glyph.style.setProperty('--glyph-mix', `${(motion.mix * 100).toFixed(1)}%`);
          glyph.style.setProperty('--glyph-glow', motion.glow.toFixed(3));
          glyph.style.zIndex = goal.state === 'active' ? '2' : goal.state === 'done' ? '1' : '0';
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [root, audio, enabled]);
}

// 浮光背景：放大并虚化的封面铺底，上面漂着十几个细线或实心的小几何图形，各自缓慢平移并整圈旋转，随响度略微胀缩；
// 另有一些光点慢慢上升、明灭。图形的种类、位置、大小和节奏由作品 id 派生，同一首歌每次打开都一样。
export type BackdropShape = { type: 'circle' | 'square' | 'triangle' | 'cross'; x: number; y: number; size: number; duration: number; delay: number; opacity: number; reverse: boolean; filled: boolean; rotate: number; band: number };
export function backdropScene(seed: string) {
  let base = 0;
  for (const char of seed) base = (base * 31 + char.charCodeAt(0)) % 100003;
  let n = 0;
  const next = () => random(base + ++n * 7.13);
  const types = ['circle', 'square', 'triangle', 'cross'] as const;
  const shapes: BackdropShape[] = Array.from({ length: 15 }, () => ({
    type: types[Math.floor(next() * types.length)], x: next() * 100, y: next() * 100, size: next(), duration: 30 + next() * 30, delay: -next() * 30,
    opacity: .11 + next() * .08, reverse: next() > .5, filled: next() < .3, rotate: next() * 360, band: Math.floor(next() * 3),
  }));
  const motes = Array.from({ length: 20 }, () => ({ x: next() * 100, y: next() * 100, size: 1 + next() * 4, peak: .08 + next() * .22, duration: 15 + next() * 20, delay: -next() * 35 }));
  return { shapes, motes };
}

// 滚动歌词的跟随动效（参照 Mineradio 的影院式排布）：当前句停在歌词区中线略偏上，整列歌词按一个连续的滚动位置平滑地追过去，
// 每帧最多走大半行；离当前句越远越淡、越小，不做模糊，远处靠上下的渐隐遮罩收住。整列随时间轻轻浮动，上下文的句子各自微微呼吸，
// 响度大时整体略微放大。逐帧写到每一行的样式上，不经过 React 渲染；减少动态效果时直接跳到位、不浮动。
export function useLyricFollow(box: RefObject<HTMLElement | null>, focus: number, enabled: boolean) {
  const target = useRef(focus);
  useEffect(() => { target.current = focus; }, [focus]);
  useEffect(() => {
    if (!enabled) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0, last = performance.now(), position = -1;
    const tick = (stamp: number) => {
      const dt = Math.min(.1, (stamp - last) / 1000), now = stamp / 1000, viewport = box.current;
      last = stamp;
      const lines = viewport ? [...viewport.querySelectorAll<HTMLElement>('.now-playing-line')] : [];
      if (viewport && lines.length) {
        const goal = clamp(target.current, 0, lines.length - 1);
        if (position < 0 || still) position = goal;
        else {
          const cap = .68 * dt * 60, step = (goal - position) * (1 - (1 - .157) ** (dt * 60));
          position = Math.abs(goal - position) < .002 ? goal : position + clamp(step, -cap, cap);
        }
        const centers = lines.map(line => line.offsetTop + line.offsetHeight / 2);
        const low = Math.floor(position), high = Math.min(lines.length - 1, low + 1), y = centers[low] + (centers[high] - centers[low]) * (position - low);
        const row = lines[low].offsetHeight || 1;
        const level = Number(viewport.closest<HTMLElement>('.now-playing')?.style.getPropertyValue('--now-playing-level')) || 0;
        const drift = still ? 0 : (Math.sin(now * .55) * .046 + Math.sin(now * 1.35) * .012) * row;
        const base = viewport.clientHeight * .45 - y + drift, swell = 1 + level * .03;
        lines.forEach((line, i) => {
          const distance = Math.abs(i - position);
          let alpha = distance < 1 ? 1 - distance * .46 : distance < 2 ? .54 - (distance - 1) * .1944 : .3456;
          alpha *= clamp(1 - Math.max(0, distance - 1.25) * .07, .16, 1) * easeInOut(clamp((5.1 - distance) / 1.1));
          const breathe = still || distance < .5 ? 1 : 1 + Math.sin(now * .68 + i * .71) * .012;
          line.style.setProperty('--line-alpha', alpha.toFixed(3));
          line.style.transform = `translateY(${base.toFixed(2)}px) scale(${(clamp(1 - distance * .026, .84, 1.02) * breathe * swell).toFixed(4)})`;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [box, enabled]);
}
