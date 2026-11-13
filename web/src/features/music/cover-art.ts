// 歌曲封面：没有封面图，每一张都按这首歌自己的“基因”画出来，和 yovoice 社区页（落地页的 community-cover.js）是同一套画法，
// 同一首歌在应用里和分享到社区后是同一张封面。
//   身份：版本编号和时长，决定配色、构图和转角；
//   声音：整首歌从头到尾的响度起伏（96 段，Generation.gene），图形照着它画；还没算出来时先按身份推一条。
// 改这里的画法时要同步改落地页，否则两边的封面会对不上。

const TAU = Math.PI * 2;
const GENE_LENGTH = 96;

// 由字符串得到可重复的随机数序列（FNV-1a 取种子，mulberry32 出数）。
function seeded(text: string) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
type Random = ReturnType<typeof seeded>;

const round = (value: number) => Math.round(value * 10) / 10;

// 还没算出响度的歌：按身份推出一条像歌的起伏（几个段落，段落里有细碎的变化）。
function guessedContour(random: Random) {
  const contour: number[] = [];
  let section = 0.5, drift = 0;
  for (let i = 0; i < GENE_LENGTH; i++) {
    if (i % 12 === 0) section = 0.3 + random() * 0.6;
    drift = drift * 0.6 + (random() - 0.5) * 0.4;
    const fade = Math.min(1, i / 5, (GENE_LENGTH - 1 - i) / 5);
    contour.push(Math.min(1, Math.max(0.05, (section + drift) * (0.35 + 0.65 * fade))));
  }
  return contour;
}

const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(((h % 360) + 360) % 360)} ${s}% ${l}%)`;
interface Colors { paper: string; a: string; b: string; ink: string; glow: string; hue: number; accent: number }

// 三种底色：夜色、浓色、纸色。hue、accent 是主色和对比色的色相，播放页背景沿用。
function palette(random: Random): Colors {
  const hue = random() * 360 + (random() - 0.5) * 36;
  const other = hue + (random() < 0.5 ? 1 : -1) * (40 + random() * 130);
  const pick = random(), tones = { hue: ((hue % 360) + 360) % 360, accent: ((other % 360) + 360) % 360 };
  if (pick < 0.42) return { paper: hsl(hue, 30, 10), a: hsl(hue, 72, 64), b: hsl(other, 82, 68), ink: '#f4f1e8', glow: hsl(hue, 72, 58), ...tones };
  if (pick < 0.74) return { paper: hsl(hue, 46, 33), a: hsl(other, 86, 74), b: hsl(hue, 34, 90), ink: '#f7f4ea', glow: hsl(hue, 60, 50), ...tones };
  return { paper: hsl(hue, 30, 88), a: hsl(hue, 62, 30), b: hsl(other, 74, 48), ink: '#1b1c19', glow: hsl(other, 74, 55), ...tones };
}

const CX = 50, CY = 42;
// 取前后几段的平均，轮廓才圆润。
const soften = (c: number[]) => c.map((_, i) => {
  const n = c.length;
  return (c[(i + n - 2) % n] + 2 * c[(i + n - 1) % n] + 3 * c[i] + 2 * c[(i + 1) % n] + c[(i + 2) % n]) / 9;
});
type Form = (c: number[], random: Random, colors: Colors) => string;
const forms: Form[] = [
  // 光环：一圈细线，顺时针走完整首歌，线越长那里越响。
  (c, random, { a, b }) => {
    const inner = 9 + random() * 7, reach = 20 + random() * 6, turn = random() * TAU;
    const lines = c.map((level, i) => {
      const angle = turn + i / c.length * TAU, cos = Math.cos(angle), sin = Math.sin(angle), outer = inner + 2 + level * reach;
      return `<line x1="${round(CX + cos * inner)}" y1="${round(CY + sin * inner)}" x2="${round(CX + cos * outer)}" y2="${round(CY + sin * outer)}" stroke="${level > 0.72 ? b : a}"/>`;
    });
    return `<g stroke-width="1.15" stroke-linecap="round">${lines.join('')}</g>`;
  },
  // 花：几层半透明的轮廓叠在一起，每层从歌的不同位置开始。
  (c, random, { a, b }) => {
    const layers = 4 + Math.floor(random() * 2), turn = random() * TAU, n = c.length;
    const soft = soften(c);
    return Array.from({ length: layers }, (_, index) => {
      const k = layers - 1 - index, shift = Math.floor(random() * n), base = 6 + k * 5, swell = 7 + k * 3;
      const points = soft.map((_, i) => {
        const angle = turn + i / n * TAU, radius = base + soft[(i + shift) % n] * swell;
        return `${round(CX + Math.cos(angle) * radius)},${round(CY + Math.sin(angle) * radius)}`;
      });
      return `<polygon points="${points.join(' ')}" fill="${k % 2 ? b : a}" fill-opacity="${round(0.42 + index * 0.13)}" stroke-linejoin="round"/>`;
    }).join('');
  },
  // 群山：一层层往下叠的山影，每一层是歌里的一小段。
  (c, random, { paper, a, b }) => {
    const rows = 6 + Math.floor(random() * 3), height = 14 + random() * 8, span = 28, soft = soften(c);
    return Array.from({ length: rows }, (_, row) => {
      const y = 30 + row * (38 / (rows - 1)), start = Math.floor(row / rows * (c.length - span));
      const points = Array.from({ length: span + 1 }, (_, k) => `${round(k / span * 100)},${round(y - soft[start + Math.min(k, span - 1)] * height)}`);
      return `<path d="M${points.join(' L')} L100,100 L0,100 Z" fill="${row % 2 ? b : a}" fill-opacity="${round(0.3 + row / rows * 0.45)}" stroke="${paper}" stroke-width="0.7" stroke-linejoin="round"/>`;
    }).join('');
  },
  // 星图：从中心一圈圈转出去的点，点越大那里越响。
  (c, random, { a, b }) => {
    const twist = 2.39996 + (random() - 0.5) * 0.05, spread = 28 + random() * 5;
    return c.map((level, i) => {
      const angle = i * twist, radius = 3 + Math.sqrt((i + 0.5) / c.length) * spread;
      return `<circle cx="${round(CX + Math.cos(angle) * radius)}" cy="${round(CY + Math.sin(angle) * radius)}" r="${round(0.45 + level * 2.5)}" fill="${level > 0.68 ? b : a}"/>`;
    }).join('');
  },
];

export type CoverArt = Colors & { svg: string };

// seed 是版本编号；gene 是 96 个十六进制字符的响度起伏，没有时按身份推一条。返回颜色和整张封面的 SVG（不含文字）。
export function coverArt(seed: string, duration: number, gene?: string): CoverArt {
  const random = seeded(`${seed}|${Math.round(duration || 0)}`);
  const colors = palette(random), form = forms[Math.floor(random() * forms.length)];
  const contour = gene?.length === GENE_LENGTH ? [...gene].map(char => 0.05 + parseInt(char, 16) / 15 * 0.95) : guessedContour(seeded(`${seed}~`));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="${colors.paper}"/>${form(contour, random, colors)}</svg>`;
  return { ...colors, svg };
}
